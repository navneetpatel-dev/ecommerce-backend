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
import { TcsLedger } from '@database/models/tcsLedger.model';
import { walletService } from '@modules/wallet/wallet.service';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { ADMIN_ROLES, ORDER_STATUS, ROLES } from '@core/constants/statuses';
import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import type { CreateZoneRequest, UpdateZoneRequest, CreateRateRequest, GetShippingRatesRequest } from './shipping.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  DEFAULT_VARIANT_WEIGHT_GRAMS,
  resolveCartVendorWeightGrams,
} from './shippingWeight';
import { resolveShippingDisplayKey } from '@modules/checkout/checkoutOrderTotals';
import { WebhookPayloadSchema } from './shipping.dto';

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

  // 2. Destroy Commission & TCS Ledgers
  await CommissionLedger.destroy({ where: { subOrderId }, transaction });
  await TcsLedger.destroy({ where: { subOrderId }, transaction });

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
      await Order.update({ status: targetStatus }, { where: { id: order.id }, transaction });
    }

    // 4. If prepaid, credit refund to customer wallet
    const isPrepaid = order.paymentMethod !== 'COD' && order.paymentStatus === 'PAID';
    const refundAmount = Number(subOrder.customerTotal ?? 0);
    if (isPrepaid && refundAmount > 0) {
      await walletService.credit(
        order.userId,
        refundAmount,
        { type: 'RTO_REFUND', id: subOrderId },
        `Refund for undelivered returned parcel (Order #${order.id.slice(0, 8).toUpperCase()})`,
        transaction,
      );
      void notificationsService.sendRefundProcessed(order.userId, subOrderId, {
        amount: refundAmount,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
      });
    }
  }
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

    const cheapestByMethod = new Map<string, ShippingQuoteRate>();
    for (const rate of scoped) {
      if (!cheapestByMethod.has(rate.method)) {
        cheapestByMethod.set(rate.method, {
          method: rate.method,
          cost: Number(rate.price),
          shippingDisplayKey: resolveShippingDisplayKey(Number(rate.price)),
          estimatedDays: Number(rate.estimatedDays),
          freeShippingThreshold:
            rate.freeShippingThreshold == null ? null : Number(rate.freeShippingThreshold),
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

    const settings = await settingsService.getPlatformSettings();
    return rates.map((rate) => {
      const threshold =
        rate.freeShippingThreshold ?? Number(settings.freeShippingThreshold ?? 0);
      const cost = productPrice >= threshold ? 0 : rate.cost;
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

  async deleteZone(id: string) {
    const zone = await ShippingZone.findByPk(id);
    if (!zone) throw new NotFoundError('ShippingZone');
    await zone.destroy();
  },

  async listAdminRates() {
    return ShippingRate.findAll({ order: [['createdAt', 'DESC']] });
  },

  async createRate(dto: CreateRateRequest, actorId: string) {
    return ShippingRate.create({
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
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(actor.role.name);
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
      const isFailedAttempt = status === 'FAILED';
      const nextFailedCount = isFailedAttempt
        ? Number(shipment.failedAttemptCount ?? 0) + 1
        : shipment.failedAttemptCount;
      const resolvedStatus =
        isFailedAttempt && nextFailedCount >= MAX_DELIVERY_ATTEMPTS
          ? 'RTO_INITIATED'
          : status;

      await shipment.update(
        {
          status: resolvedStatus as Shipment['status'],
          shippedAt: status === 'PICKED_UP' ? new Date() : shipment.shippedAt,
          deliveredAt: status === 'DELIVERED' ? new Date() : shipment.deliveredAt,
          failedAttemptCount: isFailedAttempt ? nextFailedCount : shipment.failedAttemptCount,
          lastFailedAttemptAt: isFailedAttempt ? new Date() : shipment.lastFailedAttemptAt,
          ...extra,
        },
        { transaction },
      );
      if (status === 'DELIVERED') {
        await SubOrder.update(
          { status: 'DELIVERED' },
          { where: { id: shipment.subOrderId }, transaction },
        );
        await cascadeOrderDeliveredAndNotify(shipment.subOrderId, transaction);
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

  async getVendorFreeShippingThreshold(vendorId: string): Promise<number | null> {
    const rates = await ShippingRate.findAll({
      where: {
        vendorId,
        freeShippingThreshold: { [Op.ne]: null },
      },
      attributes: ['freeShippingThreshold'],
    });
    const amounts = rates
      .map((rate) => Number(rate.freeShippingThreshold))
      .filter((amount) => Number.isFinite(amount) && amount >= 0);
    if (!amounts.length) return null;
    return Math.min(...amounts);
  },
};

/** Bound exports — do not destructure methods from `shippingService` (breaks `this`). */
export const resolveZonesForPincode = shippingService.resolveZonesForPincode.bind(
  shippingService,
);
export const getRatesForQuote = shippingService.getRatesForQuote.bind(shippingService);
