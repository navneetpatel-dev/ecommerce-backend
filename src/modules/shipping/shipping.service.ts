import crypto from 'crypto';
import { env } from '@config/env';
import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { Shipment } from '@database/models/shipment.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import type { CreateZoneRequest, UpdateZoneRequest, CreateRateRequest, GetShippingRatesRequest } from './shipping.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { settingsService } from '@modules/settings/settings.service';
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
};

function normalizeCarrier(carrier: string): string {
  return carrier.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function safeTimingEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
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

  async getShipmentByTracking(trackingNumber: string, actor: TrackingActor) {
    const shipment = await Shipment.findOne({
      where: { trackingNumber },
      include: [{
        model: SubOrder,
        as: 'subOrder',
        include: [{ model: Order, as: 'order', attributes: ['userId'] }],
        attributes: ['vendorId'],
      }],
    });
    if (!shipment) throw new NotFoundError('Shipment');

    const shipmentWithOrder = shipment as Shipment & {
      subOrder?: SubOrder & { order?: Order };
    };
    const subOrder = shipmentWithOrder.subOrder;
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(actor.role.name);
    const isCustomerOwner = actor.role.name === ROLES.CUSTOMER && subOrder?.order?.userId === actor.id;
    const isVendorOwner = actor.vendorId != null && subOrder?.vendorId === actor.vendorId;
    if (!isAdmin && !isCustomerOwner && !isVendorOwner) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    }
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
      await shipment.update(
        {
          status: status as Shipment['status'],
          shippedAt: status === 'PICKED_UP' ? new Date() : shipment.shippedAt,
          deliveredAt: status === 'DELIVERED' ? new Date() : shipment.deliveredAt,
          ...extra,
        },
        { transaction },
      );
      if (status === 'DELIVERED') {
        await SubOrder.update(
          { status: 'DELIVERED' },
          { where: { id: shipment.subOrderId }, transaction },
        );
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
