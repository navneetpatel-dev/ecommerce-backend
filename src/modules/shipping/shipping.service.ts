import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { Shipment } from '@database/models/shipment.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { Op } from 'sequelize';
import type { CreateZoneRequest, UpdateZoneRequest, CreateRateRequest } from './shipping.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

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
  }): Promise<ShippingQuoteRate[]> {
    const zones = await this.resolveZonesForPincode(params.pincode, params.state);
    if (!zones.length) return [];

    const rates = await ShippingRate.findAll({
      where: {
        zoneId: { [Op.in]: zones.map((zone) => zone.id) },
        minWeightGrams: { [Op.lte]: params.weightGrams },
        maxWeightGrams: { [Op.gte]: params.weightGrams },
        ...(params.method ? { method: params.method.toUpperCase() } : {}),
      } as any,
      order: [['price', 'ASC']],
    });

    const cheapestByMethod = new Map<string, ShippingQuoteRate>();
    for (const rate of rates) {
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

export const { resolveZonesForPincode, getRatesForQuote } = shippingService;
