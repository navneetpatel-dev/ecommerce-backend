import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { Shipment } from '@database/models/shipment.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { Op } from 'sequelize';
import type { CreateZoneRequest, UpdateZoneRequest, CreateRateRequest, GetShippingRatesRequest } from './shipping.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { settingsService } from '@modules/settings/settings.service';

export type ShippingQuoteRate = {
  method: 'STANDARD' | 'EXPRESS';
  cost: number;
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
          estimatedDays: Number(rate.estimatedDays),
          freeShippingThreshold:
            rate.freeShippingThreshold == null ? null : Number(rate.freeShippingThreshold),
          zoneId: rate.zoneId,
        });
      }
    }
    return [...cheapestByMethod.values()];
  },

  async quotePublicRates(query: GetShippingRatesRequest): Promise<ShippingQuoteRate[]> {
    let vendorId = query.vendorId ?? null;
    let weightGrams = query.weight ?? 500;
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
      weightGrams = query.weight ?? Number(variant?.weightGrams ?? 500);
      productPrice = Number(variant?.price ?? product.basePrice ?? 0);
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
      return {
        ...rate,
        cost: productPrice >= threshold ? 0 : rate.cost,
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

  async getShipmentByTracking(trackingNumber: string) {
    const shipment = await Shipment.findOne({ where: { trackingNumber } });
    if (!shipment) throw new NotFoundError('Shipment');
    return shipment;
  },

  async processWebhook(trackingNumber: string, status: string) {
    const normalizedStatus = String(status).toUpperCase().replace(/[\s-]+/g, '_');
    const mappedStatus = WEBHOOK_STATUS_MAP[normalizedStatus];
    if (!mappedStatus) throw new ValidationError(`Unsupported shipment status: ${status}`);

    const shipment = await Shipment.findOne({ where: { trackingNumber } });
    if (!shipment) throw new NotFoundError('Shipment');

    await shipment.update({
      status: mappedStatus as any,
      shippedAt: mappedStatus === 'PICKED_UP' ? new Date() : shipment.shippedAt,
      deliveredAt: mappedStatus === 'DELIVERED' ? new Date() : shipment.deliveredAt,
      updatedBy: null,
    });

    return shipment;
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
