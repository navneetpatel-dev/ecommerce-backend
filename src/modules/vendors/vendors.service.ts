import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  VENDOR_STATUS,
  ORDER_STATUS,
  COMMISSION_STATUS,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { vendorsRepository } from './vendors.repository';
import { VendorDocument } from '@database/models/vendorDocument.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import type {
  RegisterVendorRequest,
  UpdateVendorRequest,
  ApproveVendorRequest,
  RejectVendorRequest,
  SuspendVendorRequest,
  GetVendorsQuery,
  UploadDocumentRequest,
} from './vendors.dto';

function generateSlug(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export class VendorsService {
  async getPublicVendorProfile(slug: string): Promise<{
    id: string;
    businessName: string;
    slug: string;
    logoUrl: string | null;
    description: string | null;
  }> {
    const vendor = await vendorsRepository.findOne({
      where: { slug, status: VENDOR_STATUS.APPROVED },
    });
    // Suspended/pending/missing are indistinguishable to shoppers — no reason leak.
    if (!vendor) throw new NotFoundError('Vendor');
    return {
      id: vendor.id,
      businessName: vendor.businessName,
      slug: vendor.slug,
      logoUrl: vendor.logoUrl,
      description: vendor.description,
    };
  }

  async registerVendor(userId: string, data: RegisterVendorRequest) {
    return sequelize.transaction(async (t) => {
      const slug = generateSlug(data.businessName);
      
      // Check if slug already exists
      const existing = await vendorsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError('Business name already exists');
      }

      const vendor = await vendorsRepository.create({
        ...data,
        slug,
        status: VENDOR_STATUS.PENDING,
      }, { transaction: t });

      return vendor;
    });
  }

  async getVendors(query: GetVendorsQuery) {
    const offset = (query.page - 1) * query.limit;
    const { rows, count } = await vendorsRepository.findWithFilters({
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    return {
      vendors: rows,
      pagination: {
        total: count,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  }

  async getVendorById(vendorId: string) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');
    return vendor;
  }

  async updateVendor(vendorId: string, data: UpdateVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      await vendorsRepository.update(vendorId, data, { transaction: t });
      return this.getVendorById(vendorId);
    });
  }

  async approveVendor(vendorId: string, data: ApproveVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_PENDING);
      }

      await vendorsRepository.update(vendorId, {
        status: VENDOR_STATUS.APPROVED,
        commissionRate: data.commissionRate ?? vendor.commissionRate,
      }, { transaction: t });

      // TODO: Send approval notification
      return this.getVendorById(vendorId);
    });
  }

  async rejectVendor(vendorId: string, data: RejectVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_PENDING);
      }

      await vendorsRepository.update(vendorId, { status: VENDOR_STATUS.REJECTED }, { transaction: t });

      // TODO: Send rejection notification with reason
      return this.getVendorById(vendorId);
    });
  }

  async suspendVendor(vendorId: string, data: SuspendVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      await vendorsRepository.update(vendorId, { status: VENDOR_STATUS.SUSPENDED }, { transaction: t });

      // TODO: Send suspension notification with reason
      return this.getVendorById(vendorId);
    });
  }

  async uploadDocument(vendorId: string, data: UploadDocumentRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      const document = await VendorDocument.create({
        vendorId,
        type: data.type,
        url: data.url,
        verified: false,
      }, { transaction: t });

      return document;
    });
  }

  async getVendorDocuments(vendorId: string) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');

    return VendorDocument.findAll({ where: { vendorId } });
  }

  async verifyDocument(documentId: string) {
    return sequelize.transaction(async (t) => {
      const document = await VendorDocument.findByPk(documentId, { transaction: t });
      if (!document) throw new NotFoundError('VendorDocument');

      await document.update({ verified: true }, { transaction: t });
      return document;
    });
  }

  async getDashboardSummary(vendorId: string): Promise<{
    todayOrders: number;
    pendingShipments: number;
    monthRevenue: number;
    pendingPayouts: number;
    performanceScore: number | null;
  }> {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');

    const [today] = await sequelize.query<{ orders: string }>(
      `SELECT COUNT(*)::int AS orders
       FROM sub_orders
       WHERE "vendorId" = :vendorId
         AND status <> :cancelled
         AND "createdAt" >= date_trunc('day', NOW())`,
      { replacements: { vendorId, cancelled: ORDER_STATUS.CANCELLED }, type: QueryTypes.SELECT },
    );
    const [pending] = await sequelize.query<{ shipments: string }>(
      `SELECT COUNT(*)::int AS shipments
       FROM sub_orders
       WHERE "vendorId" = :vendorId
         AND status IN (:pending, :confirmed)`,
      {
        replacements: {
          vendorId,
          pending: ORDER_STATUS.PENDING,
          confirmed: ORDER_STATUS.CONFIRMED,
        },
        type: QueryTypes.SELECT,
      },
    );
    const [month] = await sequelize.query<{ revenue: string | null }>(
      `SELECT COALESCE(SUM(subtotal), 0)::numeric AS revenue
       FROM sub_orders
       WHERE "vendorId" = :vendorId
         AND status <> :cancelled
         AND "createdAt" >= date_trunc('month', NOW())`,
      { replacements: { vendorId, cancelled: ORDER_STATUS.CANCELLED }, type: QueryTypes.SELECT },
    );
    const [payout] = await sequelize.query<{ pending: string | null }>(
      `SELECT COALESCE(SUM("saleAmount" - "commissionAmount"), 0)::numeric AS pending
       FROM commission_ledgers
       WHERE "vendorId" = :vendorId AND status = :pending`,
      {
        replacements: { vendorId, pending: COMMISSION_STATUS.PENDING },
        type: QueryTypes.SELECT,
      },
    );
    return {
      todayOrders: Number(today?.orders ?? 0),
      pendingShipments: Number(pending?.shipments ?? 0),
      monthRevenue: Number(month?.revenue ?? 0),
      pendingPayouts: Number(payout?.pending ?? 0),
      performanceScore: vendor.performanceScore == null ? null : Number(vendor.performanceScore),
    };
  }
}

export const vendorsService = new VendorsService();
