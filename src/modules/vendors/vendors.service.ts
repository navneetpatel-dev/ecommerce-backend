import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  VENDOR_STATUS,
  ORDER_STATUS,
  COMMISSION_STATUS,
  ROLES,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
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
  RejectDocumentRequest,
} from './vendors.dto';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';

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
    const vendor = await sequelize.transaction(async (t) => {
      const slug = generateSlug(data.businessName);
      
      // Check if slug already exists
      const existing = await vendorsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError('Business name already exists');
      }

      const created = await vendorsRepository.create({
        ...data,
        slug,
        status: VENDOR_STATUS.PENDING,
      }, { transaction: t });

      await User.update({ vendorId: created.id }, { where: { id: userId }, transaction: t });
      return created;
    });

    void notificationsService.sendVendorApplicationReceived(userId, vendor.id, {
      businessName: vendor.businessName,
    });

    const adminRole = await Role.findOne({ where: { name: ROLES.SUPER_ADMIN } });
    if (adminRole) {
      const admins = await User.findAll({
        where: { roleId: adminRole.id },
        attributes: ['id'],
        limit: 20,
      });
      for (const admin of admins) {
        void notificationsService.sendAdminNewVendorPending(admin.id, vendor.id, {
          businessName: vendor.businessName,
        });
      }
    }

    return vendor;
  }

  async getVendors(query: GetVendorsQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await vendorsRepository.findWithFilters({
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    return {
      vendors: rows,
      pagination: buildPaginationMeta(count, query.page, query.limit),
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
        rejectionReason: null,
        suspensionReason: null,
      }, { transaction: t });

      return this.getVendorById(vendorId);
    }).then(async (updated) => {
      const ownerId = await findVendorOwnerUserId(vendorId);
      if (ownerId) {
        void notificationsService.sendVendorApproved(ownerId, vendorId, {
          businessName: updated.businessName,
        });
      }
      return updated;
    });
  }

  async rejectVendor(vendorId: string, data: RejectVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_PENDING);
      }

      await vendorsRepository.update(vendorId, {
        status: VENDOR_STATUS.REJECTED,
        rejectionReason: data.reason,
      }, { transaction: t });

      return this.getVendorById(vendorId);
    }).then(async (updated) => {
      const ownerId = await findVendorOwnerUserId(vendorId);
      if (ownerId) {
        void notificationsService.sendVendorRejected(ownerId, vendorId, {
          businessName: updated.businessName,
          reason: data.reason,
        });
      }
      return updated;
    });
  }

  async suspendVendor(vendorId: string, data: SuspendVendorRequest) {
    return sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      await vendorsRepository.update(vendorId, {
        status: VENDOR_STATUS.SUSPENDED,
        suspensionReason: data.reason,
      }, { transaction: t });

      return this.getVendorById(vendorId);
    }).then(async (updated) => {
      const ownerId = await findVendorOwnerUserId(vendorId);
      if (ownerId) {
        void notificationsService.sendVendorSuspended(ownerId, vendorId, {
          businessName: updated.businessName,
          reason: data.reason,
        });
      }
      return updated;
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

  async rejectDocument(
    documentId: string,
    data: RejectDocumentRequest,
  ): Promise<{ id: string; rejected: boolean }> {
    const document = await sequelize.transaction(async (t) => {
      const row = await VendorDocument.findByPk(documentId, { transaction: t });
      if (!row) throw new NotFoundError('VendorDocument');
      await row.update({ verified: false }, { transaction: t });
      await row.destroy({ transaction: t });
      return row;
    });

    const ownerId = await findVendorOwnerUserId(document.vendorId);
    if (ownerId) {
      void notificationsService.sendKycDocumentRejected(ownerId, document.id, {
        reason: data.reason,
      });
    }
    return { id: document.id, rejected: true };
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
