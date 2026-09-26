import crypto from 'crypto';
import { env } from '@config/env';
import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { Shipment } from '@database/models/shipment.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Address } from '@database/models/address.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { OrderItem } from '@database/models/orderItem.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { ADMIN_ROLES, ORDER_STATUS, PAYMENT_STATUS, ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/constants/permissions';
import { userHasPermission } from '@middleware/rbac.middleware';
import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import type { CreateZoneRequest, UpdateZoneRequest, CreateRateRequest, UpdateRateRequest, GetShippingRatesRequest } from './shipping.dto';
import { logAudit } from '@modules/audit/audit.service';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  DEFAULT_VARIANT_WEIGHT_GRAMS,
  resolveCartVendorWeightGrams,
} from './shippingWeight';
import { resolveShippingDisplayKey } from '@modules/checkout/checkoutOrderTotals';
import { WebhookPayloadSchema } from './shipping.dto';
import { deliveryAgentPayoutsService } from '@modules/deliveryAgents/deliveryAgentPayouts.service';
import { issueTaxInvoicesOnDispatch } from '@modules/pricing/taxInvoiceIssue';
import { issueRtoCreditNotes, refundReturnedUndeliveredPart } from './rtoSettlement';
import { isReversedPart } from '@modules/pricing/partReversal';
import { reverseTcsForReturnedPart } from '@modules/pricing/tcsLedger';

/** The platform-wide free-shipping threshold (settings), or null when none is set. */
function platformFreeShippingThreshold(settings: { freeShippingThreshold?: unknown }): number | null {
  const amount = Number(settings.freeShippingThreshold);
  return settings.freeShippingThreshold != null && Number.isFinite(amount) && amount >= 0
    ? amount
    : null;
}

/**
 * The order value above which a rate ships free: the rate's own threshold, else the
 * platform's. One definition for the product page, cart and checkout — the product page
 * used to fall back to the platform threshold while checkout did not, so a customer was
 * shown free shipping and then charged for it.
 */
function effectiveFreeShippingThreshold(
  rate: { freeShippingThreshold?: unknown },
  platformThreshold: number | null,
): number | null {
  if (rate.freeShippingThreshold == null) return platformThreshold;
  const amount = Number(rate.freeShippingThreshold);
  return Number.isFinite(amount) ? amount : platformThreshold;
}

/** Shipment statuses that mean the goods have been dispatched. */
const DISPATCHED_SHIPMENT_STATUSES = new Set([
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

export type ShippingQuoteRate = {
  method: 'STANDARD' | 'EXPRESS';
  cost: number;
  shippingDisplayKey: 'FREE' | 'PAID';
  estimatedDays: number;
  freeShippingThreshold: number | null;
  zoneId: string;
};

const WEBHOOK_STATUS_MAP: Record<string, string> = {
  PICKEDUP: 'PICKED_UP',
  PICKED_UP: 'PICKED_UP',
  INTRANSIT: 'IN_TRANSIT',
  IN_TRANSIT: 'IN_TRANSIT',
  OUTFORDELIVERY: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'FAILED',
  CANCELED: 'FAILED',
};

/**
 * Canonical forward transitions for every caller of `applyShipmentStatus`
 * (agent update, OTP confirm, carrier webhook). Skips are allowed so a
 * webhook can jump e.g. IN_TRANSIT → DELIVERED. Terminal statuses have no
 * outbound edges — duplicates and regressions no-op instead of throwing.
 */
const SHIPMENT_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  RTO_INITIATED: ['RTO_DELIVERED'],
  DELIVERED: [],
  RTO_DELIVERED: [],
};

function isTerminalShipmentStatus(status: string): boolean {
  return status === 'DELIVERED' || status === 'RTO_DELIVERED';
}

type TrackingActor = {
  id: string;
  vendorId: string | null;
  role: { name: string };
} | null;

function normalizeCarrier(carrier: string): string {
  return carrier.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function safeTimingEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

/** After this many failed doorstep attempts, the parcel routes back to the vendor hub instead of retrying. */
const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Once a suborder is marked DELIVERED: promote the parent Order to DELIVERED
 * once every sibling suborder has settled (delivered/cancelled/returned), and
 * always notify the customer for this suborder — neither happened before.
 */
async function cascadeOrderDeliveredAndNotify(subOrderId: string, transaction: Transaction): Promise<void> {
  const subOrder = await SubOrder.findByPk(subOrderId, { transaction });
  if (!subOrder) return;

  const siblings = await SubOrder.findAll({ where: { orderId: subOrder.orderId }, transaction });
  const terminal = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
  const allSettled = siblings.every((sibling) => terminal.has(sibling.status));
  const anyDelivered = siblings.some((sibling) => sibling.status === 'DELIVERED');
  if (allSettled && anyDelivered) {
    await Order.update(
      { status: ORDER_STATUS.DELIVERED },
      { where: { id: subOrder.orderId }, transaction },
    );
  }

  const order = await Order.findByPk(subOrder.orderId, { transaction, attributes: ['userId'] });
  if (order) {
    void notificationsService.sendSubOrderDelivered(order.userId, subOrderId, {
      orderId: subOrder.orderId,
      orderNumber: subOrder.orderId.slice(0, 8).toUpperCase(),
    });
  }
}

/**
 * Cascades an RTO parcel handover back to origin:
 * 1. Sets SubOrder.status = 'RETURNED'
 * 2. Restocks variant inventory
 * 3. Destroys pending vendor commission & TCS ledger entries
 * 4. Settles parent Order.status (RETURNED / DELIVERED)
 * 5. If prepaid, credits refund to customer's wallet
 * 6. Notifies customer of RTO completion and refund
 */
async function cascadeRtoDeliveredAndSettle(
  subOrderId: string,
  transaction: Transaction,
): Promise<void> {
  const subOrder = (await SubOrder.findByPk(subOrderId, {
    include: [
      { model: OrderItem, as: 'items' },
      { model: Order, as: 'order' },
    ],
    transaction,
  })) as (SubOrder & { items?: OrderItem[]; order?: Order }) | null;
  if (!subOrder) return;

  await subOrder.update({ status: 'RETURNED' }, { transaction });

  // 1. Restock items
  for (const item of subOrder.items ?? []) {
    const variantId = (item as any).variantId ?? (item as any).productVariantId;
    if (variantId) {
      await ProductVariant.increment('stock', {
        by: item.quantity,
        where: { id: variantId },
        transaction,
      });
    }
  }

  // 2. Destroy the commission ledgers (never paid out: nothing was delivered). The TCS
  // was reported when the part was dispatched — reverse it, don't delete it.
  await CommissionLedger.destroy({ where: { subOrderId }, transaction });
  await reverseTcsForReturnedPart(subOrder, transaction);

  // 3. Settle parent Order
  const order = subOrder.order;
  if (order) {
    const siblings = await SubOrder.findAll({ where: { orderId: order.id }, transaction });
    const terminal = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
    const allSettled = siblings.every((s) => terminal.has(s.status));
    if (allSettled) {
      const anyDelivered = siblings.some((s) => s.status === 'DELIVERED');
      const allReturned = siblings.every((s) => s.status === 'RETURNED');
      const targetStatus = anyDelivered
        ? ORDER_STATUS.DELIVERED
        : allReturned
          ? ORDER_STATUS.RETURNED
          : ORDER_STATUS.CANCELLED;
      await Order.update(
        {
          status: targetStatus,
          // Nothing was delivered: no cashback will ever be due (as on a full cancellation).
          ...(anyDelivered ? {} : { pendingCashbackAmount: 0 }),
        },
        { where: { id: order.id }, transaction },
      );
    }

    // 4. Refund the part the way a cancellation does: its wallet share back as the
    // checkout spend it was, its cash share back to the card (after commit). The last
    // part of the order to come back returns whatever is left, gift-wrap fee included.
    await refundReturnedUndeliveredPart(subOrder, order, siblings, transaction);
    // 5. Credit note for the tax invoice issued at dispatch: the supply was reversed.
    await issueRtoCreditNotes(subOrder, order, siblings, transaction);
  }
  // 6. A COD order whose other parcels were already delivered and paid is paid in full now.
  await settleCodPaymentIfComplete(subOrderId, transaction);
}

/** Prompts the customer to reschedule (or informs them of RTO) after a failed doorstep attempt. */
async function notifyCustomerOfFailedAttempt(
  shipment: Shipment,
  resolvedStatus: string,
  transaction: Transaction,
): Promise<void> {
  const subOrder = await SubOrder.findByPk(shipment.subOrderId, { transaction });
  if (!subOrder) return;
  const order = await Order.findByPk(subOrder.orderId, { transaction, attributes: ['userId'] });
  if (!order) return;

  void notificationsService.sendDeliveryAttemptFailed(order.userId, shipment.id, {
    trackingNumber: shipment.trackingNumber,
    reason:
      resolvedStatus === 'RTO_INITIATED'
        ? 'Delivery could not be completed after 3 attempts — the parcel is being returned to the seller.'
        : (shipment.failureReason ?? 'Delivery attempt unsuccessful'),
    failedAttemptCount: shipment.failedAttemptCount,
  });
}

/**
 * Marks the order PAID once every COD shipment still owed has had cash collected at the
 * door. A parcel that came back undelivered (RTO) owes nothing — its part is reversed —
 * so it no longer holds the order unpaid once the other parcels are delivered and paid.
 * Runs on delivery and on RTO, whichever settles the order last.
 */
async function settleCodPaymentIfComplete(subOrderId: string, transaction: Transaction) {
  const subOrder = await SubOrder.findByPk(subOrderId, { transaction });
  if (!subOrder) return;
  const order = await Order.findByPk(subOrder.orderId, { transaction });
  if (!order || order.paymentMethod !== 'COD' || order.paymentStatus === PAYMENT_STATUS.PAID) return;

  const siblingShipments = (await Shipment.findAll({
    include: [{ association: 'subOrder', where: { orderId: order.id }, attributes: ['status'] }],
    transaction,
  })) as (Shipment & { subOrder?: SubOrder })[];
  const codShipments = siblingShipments.filter(
    (s) =>
      s.codAmount != null &&
      s.status !== 'RTO_INITIATED' &&
      s.status !== 'RTO_DELIVERED' &&
      !isReversedPart(s.subOrder?.status),
  );
  const allCollected = codShipments.length > 0 && codShipments.every((s) => s.codCollected);
  if (allCollected) {
    await order.update({ paymentStatus: PAYMENT_STATUS.PAID }, { transaction });
  }
}

export const shippingService = {
  async resolveZonesForPincode(pincode: string, state?: string) {
    const normalized = String(pincode).trim();
    const prefixes = [normalized.slice(0, 3), normalized.slice(0, 2), normalized].filter(Boolean);
    const zones = await ShippingZone.findAll();
    return zones.filter((zone) => {
      const configuredPrefixes = (zone.pincodePrefixes ?? []).map(String);
      if (configuredPrefixes.length) {
        return prefixes.some((prefix) => configuredPrefixes.includes(prefix));
      }
      const normalizedState = state?.trim().toLowerCase();
      return (zone.states ?? []).some(
        (candidate) =>
          String(candidate).toLowerCase() === 'all' ||
          (normalizedState != null && String(candidate).toLowerCase() === normalizedState),
      );
    });
  },

  async getRatesForQuote(params: {
    pincode: string;
    weightGrams: number;
    method?: string;
    state?: string;
    vendorId?: string | null;
  }): Promise<ShippingQuoteRate[]> {
    const zones = await shippingService.resolveZonesForPincode(
      params.pincode,
      params.state,
    );
    if (!zones.length) return [];

    const zoneIds = zones.map((zone) => zone.id);
    const methodFilter = params.method
      ? { method: params.method.toUpperCase() }
      : {};
    const weightFloorWhere = {
      zoneId: { [Op.in]: zoneIds },
      minWeightGrams: { [Op.lte]: params.weightGrams },
      ...methodFilter,
    } as any;

    let rates = await ShippingRate.findAll({
      where: {
        ...weightFloorWhere,
        maxWeightGrams: { [Op.gte]: params.weightGrams },
      } as any,
      order: [['price', 'ASC']],
    });

    // Heavy carts may exceed the highest configured slab — use the top tier instead.
    if (!rates.length) {
      rates = await ShippingRate.findAll({
        where: weightFloorWhere,
        order: [['maxWeightGrams', 'DESC'], ['price', 'ASC']],
      });
    }

    let scoped = rates;
    if (params.vendorId) {
      const vendorRates = rates.filter((rate) => rate.vendorId === params.vendorId);
      scoped = vendorRates.length
        ? vendorRates
        : rates.filter((rate) => rate.vendorId == null);
    }

    const platformThreshold = platformFreeShippingThreshold(
      await settingsService.getPlatformSettings(),
    );
    const cheapestByMethod = new Map<string, ShippingQuoteRate>();
    for (const rate of scoped) {
      if (!cheapestByMethod.has(rate.method)) {
        cheapestByMethod.set(rate.method, {
          method: rate.method,
          cost: Number(rate.price),
          shippingDisplayKey: resolveShippingDisplayKey(Number(rate.price)),
          estimatedDays: Number(rate.estimatedDays),
          freeShippingThreshold: effectiveFreeShippingThreshold(rate, platformThreshold),
          zoneId: rate.zoneId,
        });
      }
    }
    return [...cheapestByMethod.values()];
  },

  async quotePublicRates(
    query: GetShippingRatesRequest,
    cartContext?: { userId: string | null; sessionId: string | null },
  ): Promise<ShippingQuoteRate[]> {
    let vendorId = query.vendorId ?? null;
    let weightGrams = query.weight ?? DEFAULT_VARIANT_WEIGHT_GRAMS;
    let productPrice: number | null = null;

    if (query.productId) {
      const product = await Product.scope('customerVisible').findByPk(query.productId, {
        include: [{ model: ProductVariant, as: 'variants' }],
      });
      if (!product) throw new NotFoundError('Product');
      vendorId = vendorId ?? product.vendorId;
      const variants = product.variants ?? [];
      const variant = query.variantId
        ? variants.find((row) => row.id === query.variantId) ?? null
        : variants[0] ?? null;
      if (query.variantId && !variant) throw new NotFoundError('ProductVariant');
      weightGrams = Number(variant?.weightGrams ?? DEFAULT_VARIANT_WEIGHT_GRAMS);
      productPrice = Number(variant?.price ?? product.basePrice ?? 0);
    } else if (query.vendorId) {
      weightGrams = await resolveCartVendorWeightGrams({
        userId: cartContext?.userId ?? null,
        sessionId: cartContext?.sessionId ?? null,
        vendorId: query.vendorId,
      });
    }

    const rates = await shippingService.getRatesForQuote({
      pincode: query.pincode,
      weightGrams,
      method: query.method,
      state: query.state,
      vendorId,
    });

    if (!query.productId || productPrice == null) return rates;

    // The rate's threshold is already the effective one (its own, else the platform's),
    // the same the cart and checkout charge by.
    return rates.map((rate) => {
      const threshold = rate.freeShippingThreshold;
      const cost = threshold != null && productPrice >= threshold ? 0 : rate.cost;
      return {
        ...rate,
        cost,
        shippingDisplayKey: resolveShippingDisplayKey(cost),
      };
    });
  },

  async listZones(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await ShippingZone.findAndCountAll({
      order: [['name', 'ASC']],
      limit: query.limit,
      offset,
    });
    return {
      zones: rows,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  },

  async createZone(dto: CreateZoneRequest, actorId: string) {
    return ShippingZone.create({
      name: dto.name,
      states: dto.states ?? [],
      pincodePrefixes: dto.pincodePrefixes ?? [],
      createdBy: actorId,
      updatedBy: null,
      deletedBy: null,
    });
  },

  async updateZone(id: string, dto: UpdateZoneRequest, actorId: string) {
    const zone = await ShippingZone.findByPk(id);
    if (!zone) throw new NotFoundError('ShippingZone');
    return zone.update({ ...dto, updatedBy: actorId });
  },

  async deleteZone(id: string, actorId?: string) {
    const zone = await ShippingZone.findByPk(id);
    if (!zone) throw new NotFoundError('ShippingZone');
    await zone.destroy();

    if (actorId) {
      await logAudit({
        actorId,
        action: 'SHIPPING_ZONE_DELETED',
        entityType: 'ShippingZone',
        entityId: id,
        metadata: { name: zone.name },
      });
    }
  },

  async listAdminRates() {
    return ShippingRate.findAll({ order: [['createdAt', 'DESC']] });
  },

  async createRate(dto: CreateRateRequest, actorId: string) {
    const rate = await ShippingRate.create({
      zoneId: dto.zoneId,
      method: dto.method,
      minWeightGrams: dto.minWeightGrams ?? 0,
      maxWeightGrams: dto.maxWeightGrams,
      price: dto.price,
      estimatedDays: dto.estimatedDays,
      freeShippingThreshold: dto.freeShippingThreshold ?? null,
      vendorId: dto.vendorId ?? null,
      createdBy: actorId,
      updatedBy: null,
      deletedBy: null,
    });

    await logAudit({
      actorId,
      action: 'SHIPPING_RATE_CREATED',
      entityType: 'ShippingRate',
      entityId: rate.id,
      metadata: { zoneId: dto.zoneId, method: dto.method, price: dto.price },
    });

    return rate;
  },

  async updateRate(id: string, dto: UpdateRateRequest, actorId: string) {
    const rate = await ShippingRate.findByPk(id);
    if (!rate) throw new NotFoundError('ShippingRate');

    await rate.update({
      ...(dto.zoneId !== undefined ? { zoneId: dto.zoneId } : {}),
      ...(dto.method !== undefined ? { method: dto.method } : {}),
      ...(dto.minWeightGrams !== undefined ? { minWeightGrams: dto.minWeightGrams } : {}),
      ...(dto.maxWeightGrams !== undefined ? { maxWeightGrams: dto.maxWeightGrams } : {}),
      ...(dto.price !== undefined ? { price: dto.price } : {}),
      ...(dto.estimatedDays !== undefined ? { estimatedDays: dto.estimatedDays } : {}),
      ...(dto.freeShippingThreshold !== undefined ? { freeShippingThreshold: dto.freeShippingThreshold } : {}),
      ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
      updatedBy: actorId,
    });

    await logAudit({
      actorId,
      action: 'SHIPPING_RATE_UPDATED',
      entityType: 'ShippingRate',
      entityId: id,
      metadata: { patch: dto },
    });

    return rate;
  },

  async deleteRate(id: string, actorId: string) {
    const rate = await ShippingRate.findByPk(id);
    if (!rate) throw new NotFoundError('ShippingRate');

    await rate.destroy();

    await logAudit({
      actorId,
      action: 'SHIPPING_RATE_DELETED',
      entityType: 'ShippingRate',
      entityId: id,
    });
  },

  async getShipmentByTracking(trackingNumber: string, actor: TrackingActor): Promise<Record<string, unknown>> {
    const shipment = await Shipment.findOne({
      where: { trackingNumber },
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          include: [{
            model: Order,
            as: 'order',
            attributes: ['userId'],
            include: [{ model: Address, as: 'shippingAddress', attributes: ['lat', 'lng'] }],
          }],
          attributes: ['vendorId'],
        },
        {
          model: DeliveryAgent,
          as: 'deliveryAgent',
          attributes: ['id', 'fullName', 'lastLat', 'lastLng', 'locationUpdatedAt'],
        },
      ],
    });
    if (!shipment) throw new NotFoundError('Shipment');

    // Anonymous / guest lookup: tracking number acts as the shared secret (carrier-site
    // convention), so only carrier-facing fields are returned — never customer PII.
    if (!actor) {
      return {
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
        trackingUrl: shipment.trackingUrl,
        status: shipment.status,
        lastUpdate: shipment.updatedAt,
        estimatedDeliveryDate: shipment.estimatedDeliveryDate,
      };
    }

    const shipmentWithOrder = shipment as Shipment & {
      subOrder?: SubOrder & { order?: Order & { shippingAddress?: Address | null } };
    };
    const subOrder = shipmentWithOrder.subOrder;
    const isAdmin =
      (ADMIN_ROLES as readonly string[]).includes(actor.role.name) ||
      (await userHasPermission(actor, PERMISSIONS.SHIPPING_MANAGE, PERMISSIONS.ORDER_MANAGE));
    const isCustomerOwner = actor.role.name === ROLES.CUSTOMER && subOrder?.order?.userId === actor.id;
    const isVendorOwner = actor.vendorId != null && subOrder?.vendorId === actor.vendorId;
    const isDeliveryAgent = actor.role.name === ROLES.DELIVERY_AGENT;
    if (!isAdmin && !isCustomerOwner && !isVendorOwner && !isDeliveryAgent) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    }
    const plain = shipment.get({ plain: true }) as Record<string, unknown>;
    const destinationAddress = subOrder?.order?.shippingAddress as
      | { lat: number | null; lng: number | null }
      | undefined;
    return {
      ...plain,
      lastUpdate: shipment.updatedAt,
      destination:
        destinationAddress?.lat != null && destinationAddress?.lng != null
          ? { lat: Number(destinationAddress.lat), lng: Number(destinationAddress.lng) }
          : null,
    };
  },

  /** Customer picks a redelivery window after a FAILED attempt (tracking page CTA). */
  async rescheduleDelivery(trackingNumber: string, userId: string, slot: string): Promise<Shipment> {
    const shipment = await Shipment.findOne({
      where: { trackingNumber },
      include: [{
        model: SubOrder,
        as: 'subOrder',
        include: [{ model: Order, as: 'order', attributes: ['userId'] }],
      }],
    });
    if (!shipment) throw new NotFoundError('Shipment');
    const owner = (shipment as Shipment & { subOrder?: SubOrder & { order?: Order } }).subOrder?.order
      ?.userId;
    if (owner !== userId) throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    if (shipment.status === 'RTO_INITIATED' || shipment.status === 'RTO_DELIVERED') {
      throw new ValidationError({
        status: ['This parcel has exceeded delivery attempts and is being returned to the seller. It cannot be rescheduled.'],
      });
    }
    if (shipment.status !== 'FAILED') {
      throw new ValidationError({ status: ['Only a failed delivery attempt can be rescheduled'] });
    }
    await shipment.update({ preferredRedeliverySlot: slot, status: 'IN_TRANSIT' });
    return shipment;
  },

  async handleWebhook(
    carrier: string,
    rawBody: Buffer | string,
    signature: string | undefined,
    suppliedEventId?: string,
  ) {
    const normalizedCarrier = normalizeCarrier(carrier);
    const secret = env.SHIPPING_WEBHOOK_SECRETS[normalizedCarrier];
    if (!secret) {
      throw new AppError(ERROR_MESSAGES.SHIPPING_WEBHOOK_NOT_CONFIGURED, 503, ERROR_CODES.CONFIG_ERROR);
    }
    if (!signature) {
      throw new AppError(ERROR_MESSAGES.INVALID_SIGNATURE, 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
    if (!safeTimingEqual(expected, signature)) {
      throw new AppError(ERROR_MESSAGES.INVALID_SIGNATURE, 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyString);
    } catch {
      throw new ValidationError(ERROR_MESSAGES.INVALID_WEBHOOK_PAYLOAD);
    }
    const { trackingNumber, status } = WebhookPayloadSchema.parse(payload);
    const eventId = suppliedEventId?.trim() || crypto.createHash('sha256').update(bodyString).digest('hex');
    if (!normalizedCarrier || eventId.length > 191) {
      throw new ValidationError(ERROR_MESSAGES.INVALID_WEBHOOK_PAYLOAD);
    }

    return sequelize.transaction(async (transaction) => {
      const [, created] = await WebhookEvent.findOrCreate({
        where: { provider: `shipping:${normalizedCarrier}`, eventId },
        defaults: {
          provider: `shipping:${normalizedCarrier}`,
          eventId,
          payload: payload as Record<string, unknown>,
        },
        transaction,
      });
      if (!created) return { received: true, duplicate: true };

      const shipment = await shippingService.processWebhook(
        trackingNumber,
        status,
        transaction,
      );
      return { received: true, duplicate: false, shipment };
    });
  },

  async processWebhook(
    trackingNumber: string,
    status: string,
    transaction?: Transaction,
  ) {
    const normalizedStatus = String(status).toUpperCase().replace(/[\s-]+/g, '_');
    const mappedStatus = WEBHOOK_STATUS_MAP[normalizedStatus];
    if (!mappedStatus) throw new ValidationError(ERROR_MESSAGES.SHIPPING_STATUS_UNSUPPORTED);

    const shipment = await Shipment.findOne({
      where: { trackingNumber },
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
    if (!shipment) throw new NotFoundError('Shipment');

    return shippingService.applyShipmentStatus(
      shipment,
      mappedStatus,
      { updatedBy: null },
      transaction,
    );
  },

  async applyShipmentStatus(
    shipment: Shipment,
    status: string,
    extra: Partial<Shipment> = {},
    existingTransaction?: Transaction,
  ) {
    const apply = async (transaction: Transaction) => {
      if (shipment.status === status) {
        if (isTerminalShipmentStatus(status) || status === 'FAILED') {
          return shipment;
        }
        await shipment.update({ ...extra }, { transaction });
        return shipment;
      }
      if (!SHIPMENT_STATUS_TRANSITIONS[shipment.status]?.includes(status)) {
        return shipment;
      }

      const isFailedAttempt = status === 'FAILED';
      const nextFailedCount = isFailedAttempt
        ? Number(shipment.failedAttemptCount ?? 0) + 1
        : shipment.failedAttemptCount;
      const resolvedStatus =
        isFailedAttempt && nextFailedCount >= MAX_DELIVERY_ATTEMPTS
          ? 'RTO_INITIATED'
          : status;
      const isCodDelivery = status === 'DELIVERED' && shipment.codAmount != null;

      await shipment.update(
        {
          status: resolvedStatus as Shipment['status'],
          shippedAt: status === 'PICKED_UP' ? new Date() : shipment.shippedAt,
          deliveredAt: status === 'DELIVERED' ? new Date() : shipment.deliveredAt,
          failedAttemptCount: isFailedAttempt ? nextFailedCount : shipment.failedAttemptCount,
          lastFailedAttemptAt: isFailedAttempt ? new Date() : shipment.lastFailedAttemptAt,
          ...(isCodDelivery
            ? {
                codCollected: true,
                codCollectedAt: extra.codCollectedAt ?? new Date(),
              }
            : {}),
          ...extra,
        },
        { transaction },
      );
      if (DISPATCHED_SHIPMENT_STATUSES.has(status)) {
        // The goods have left the seller: issue the tax invoices (not at checkout).
        await issueTaxInvoicesOnDispatch(shipment.subOrderId, transaction);
      }
      if (status === 'DELIVERED') {
        await SubOrder.update(
          { status: 'DELIVERED' },
          { where: { id: shipment.subOrderId }, transaction },
        );
        await cascadeOrderDeliveredAndNotify(shipment.subOrderId, transaction);
        await settleCodPaymentIfComplete(shipment.subOrderId, transaction);
        if (shipment.deliveryAgentId) {
          await deliveryAgentPayoutsService.recordEarning(
            shipment.deliveryAgentId,
            'DELIVERY',
            shipment.id,
            transaction,
          );
        }
      }
      if (status === 'RTO_DELIVERED') {
        await cascadeRtoDeliveredAndSettle(shipment.subOrderId, transaction);
      }
      if (isFailedAttempt) {
        await notifyCustomerOfFailedAttempt(shipment, resolvedStatus, transaction);
      }
      return shipment;
    };
    return existingTransaction ? apply(existingTransaction) : sequelize.transaction(apply);
  },

  /**
   * The "free shipping above ₹X" a vendor's product page can promise wherever it ships:
   * the highest effective threshold across the rates that apply to the vendor (its own,
   * else the platform-wide ones — as quotes pick them). It used to be the lowest of the
   * vendor's own thresholds, which a customer in a zone with a higher one did not get.
   * Null when some applicable rate is never free. A platform product (no vendor) uses
   * the platform-wide rates.
   */
  async getVendorFreeShippingThreshold(vendorId: string | null): Promise<number | null> {
    const own = vendorId
      ? await ShippingRate.findAll({
          where: { vendorId },
          attributes: ['freeShippingThreshold'],
        })
      : [];
    const rates = own.length
      ? own
      : await ShippingRate.findAll({
          where: { vendorId: null },
          attributes: ['freeShippingThreshold'],
        });
    if (!rates.length) return null;
    const platformThreshold = platformFreeShippingThreshold(
      await settingsService.getPlatformSettings(),
    );
    const thresholds = rates.map((rate) => effectiveFreeShippingThreshold(rate, platformThreshold));
    if (thresholds.some((threshold) => threshold == null)) return null;
    return Math.max(...(thresholds as number[]));
  },
};

/** Bound exports — do not destructure methods from `shippingService` (breaks `this`). */
export const resolveZonesForPincode = shippingService.resolveZonesForPincode.bind(
  shippingService,
);
export const getRatesForQuote = shippingService.getRatesForQuote.bind(shippingService);
