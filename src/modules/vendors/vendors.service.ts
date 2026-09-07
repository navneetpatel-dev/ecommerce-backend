import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import { ROLES, VENDOR_STATUS, ORDER_STATUS, COMMISSION_STATUS, PRODUCT_STATUS } from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise } from '@modules/pricing/money';
import { sqlVendorNetPayoutPaise, sqlFrozenPaise, REPORTABLE_ORDER_SQL } from '@modules/pricing/frozenMoneySql';
import {
  deleteS3ObjectIfReplaced,
  cascadeDeleteEntityMedia,
  S3_ENTITY_TYPES,
} from '@core/s3';
import { extractS3KeyFromUrl, signedGetObjectUrl } from '@config/s3';
import { vendorsRepository } from './vendors.repository';
import { VendorDocument } from '@database/models/vendorDocument.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Product } from '@database/models/product.model';
import { Category } from '@database/models/category.model';
import { Role } from '@database/models/role.model';
import { sequelize } from '@database/models';
import { Op, QueryTypes, type Transaction } from 'sequelize';
import type {
  RegisterVendorRequest,
  UpdateVendorRequest,
  ApproveVendorRequest,
  RejectVendorRequest,
  SuspendVendorRequest,
  GetVendorsQuery,
  VendorDirectoryQuery,
  UploadDocumentRequest,
  RejectDocumentRequest,
  ResolveDocumentsQuery,
} from './vendors.dto';
import { User } from '@database/models/user.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  findSuperAdminUserIds,
  findVendorOwnerUserId,
} from '@modules/notifications/orderNotifications';
import { logAudit } from '@modules/audit/audit.service';
import { clearPermissionCache, resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  areCategoryDocumentsSatisfied,
  buildKycChecklist,
  resolveRequiredDocuments,
} from './documentRequirements';

/**
 * Hours from suborder creation to delivery counted as "on time" for the vendor
 * analytics fulfillment SLA. No platform-wide SLA constant exists yet to reuse
 * (see `reportVendorFulfillmentSla`, which reports raw hours-to-deliver per row
 * without an on-time/late split) — 72h (3 days) is a reasonable e-commerce default.
 */
const VENDOR_FULFILLMENT_SLA_HOURS = 72;

function generateSlug(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeName(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectNameMismatch(
  panHolderName?: string,
  bankAccountHolderName?: string,
): boolean {
  const pan = normalizeName(panHolderName);
  const bank = normalizeName(bankAccountHolderName);
  if (!pan || !bank) return false;
  return pan !== bank;
}

async function assertCategoriesExist(categoryIds: string[], transaction?: Transaction) {
  const rows = await Category.findAll({
    where: { id: { [Op.in]: categoryIds } },
    attributes: ['id'],
    transaction,
  });
  if (rows.length !== categoryIds.length) {
    throw new ValidationError({ categoryIds: [ERROR_MESSAGES.VENDOR_CATEGORIES_INVALID] });
  }
}

async function syncVendorCategories(
  vendorId: string,
  categoryIds: string[],
  transaction: Transaction,
) {
  await VendorCategory.destroy({ where: { vendorId }, transaction, force: true });
  if (categoryIds.length === 0) return;
  await VendorCategory.bulkCreate(
    categoryIds.map((categoryId) => ({ vendorId, categoryId })),
    { transaction },
  );
}

async function getVendorCategoryIds(vendorId: string, transaction?: Transaction) {
  const links = await VendorCategory.findAll({
    where: { vendorId },
    attributes: ['categoryId'],
    transaction,
  });
  return links.map((link) => link.categoryId);
}

export class VendorsService {
  async getPublicVendorProfile(slug: string): Promise<{
    id: string;
    businessName: string;
    slug: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    description: string | null;
  }> {
    const vendor = await vendorsRepository.findOne({
      slug,
      status: VENDOR_STATUS.APPROVED,
    });
    if (!vendor) throw new NotFoundError('Vendor');
    return {
      id: vendor.id,
      businessName: vendor.businessName,
      slug: vendor.slug,
      logoUrl: vendor.logoUrl,
      bannerUrl: vendor.bannerUrl ?? null,
      description: vendor.description,
    };
  }

  async previewRequiredDocuments(query: ResolveDocumentsQuery) {
    const requiredDocumentTypes = await resolveRequiredDocuments(
      query.entityType,
      query.categoryIds,
    );
    return { requiredDocumentTypes };
  }

  async registerVendor(userId: string, data: RegisterVendorRequest) {
    const nameMismatchWarning = detectNameMismatch(
      data.panHolderName,
      data.bankAccountHolderName,
    );

    const bankDetails = {
      ...(data.bankDetails ?? {}),
      ...(data.panHolderName ? { panHolderName: data.panHolderName } : {}),
      ...(data.bankAccountHolderName
        ? { accountHolderName: data.bankAccountHolderName }
        : {}),
    };

    const vendor = await sequelize.transaction(async (t) => {
      const slug = generateSlug(data.businessName);
      const existing = await vendorsRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_BUSINESS_NAME_EXISTS);
      }

      await assertCategoriesExist(data.categoryIds, t);

      const created = await vendorsRepository.create(
        {
          businessName: data.businessName,
          gstNumber: data.gstNumber ?? null,
          state: data.state ?? null,
          entityType: data.entityType,
          bankDetails,
          description: data.description ?? null,
          slug,
          status: VENDOR_STATUS.PENDING,
        } as any,
        { transaction: t },
      );

      await syncVendorCategories(created.id, data.categoryIds, t);

      const ownerRole = await Role.findOne({
        where: { name: ROLES.VENDOR_OWNER },
        transaction: t,
      });
      if (!ownerRole) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
      }

      await User.update(
        { vendorId: created.id, roleId: ownerRole.id },
        { where: { id: userId }, transaction: t },
      );
      return created;
    });

    clearPermissionCache();

    void notificationsService.sendVendorApplicationReceived(userId, vendor.id, {
      businessName: vendor.businessName,
    });

    const adminIds = await findSuperAdminUserIds();
    for (const adminId of adminIds) {
      void notificationsService.sendAdminNewVendorPending(adminId, vendor.id, {
        businessName: vendor.businessName,
      });
    }

    const checklist = await buildKycChecklist(vendor.id, vendor.entityType, data.categoryIds);
    return {
      vendor,
      requiredDocumentTypes: checklist.requiredDocumentTypes,
      checklist: checklist.items,
      nameMismatchWarning,
    };
  }

  async getVendors(query: GetVendorsQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await vendorsRepository.findWithFilters({
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    const vendors = await Promise.all(
      rows.map(async (row) => {
        const plain = row.get({ plain: true });
        const categoryIds = await getVendorCategoryIds(row.id);
        const checklist = await buildKycChecklist(row.id, row.entityType, categoryIds);
        return {
          ...plain,
          categoryIds,
          kycComplete: checklist.isComplete,
        };
      }),
    );

    return {
      vendors,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listApprovedDirectory(query: VendorDirectoryQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await vendorsRepository.findWithFilters({
      status: VENDOR_STATUS.APPROVED,
      search: query.search,
      limit: query.limit,
      offset,
    });

    const vendors = rows.map((row) => {
      const plain = row.get({ plain: true });
      return {
        id: plain.id as string,
        businessName: plain.businessName as string,
      };
    });

    return {
      vendors,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /** Public storefront vendor index — APPROVED shops only. */
  async listStorefrontVendors(query: VendorDirectoryQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await vendorsRepository.findWithFilters({
      status: VENDOR_STATUS.APPROVED,
      search: query.search,
      limit: query.limit,
      offset,
    });

    const vendors = rows.map((row) => {
      const plain = row.get({ plain: true });
      return {
        id: plain.id as string,
        businessName: plain.businessName as string,
        slug: plain.slug as string,
        logoUrl: (plain.logoUrl as string | null) ?? null,
        description: (plain.description as string | null) ?? null,
      };
    });

    return {
      vendors,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async getVendorById(vendorId: string) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');
    const categoryIds = await getVendorCategoryIds(vendorId);
    return {
      ...vendor.get({ plain: true }),
      categoryIds,
    };
  }

  async getMyVendor(userVendorId: string | null | undefined) {
    if (!userVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    return this.getVendorById(userVendorId);
  }

  async updateMyVendor(userVendorId: string | null | undefined, data: UpdateVendorRequest) {
    if (!userVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    // commissionRate is admin-only (set via approval or PATCH /vendors/:id) — strip it
    // here so a vendor owner can't self-set their own commission via PATCH /vendors/me.
    const { commissionRate: _commissionRate, ...selfServiceData } = data;
    return this.updateVendor(userVendorId, selfServiceData);
  }

  async updateVendor(vendorId: string, data: UpdateVendorRequest) {
    await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      if (data.categoryIds) {
        await assertCategoriesExist(data.categoryIds, t);
        await syncVendorCategories(vendorId, data.categoryIds, t);
      }

      const { categoryIds: _categoryIds, ...vendorFields } = data;
      await vendorsRepository.update(vendorId, vendorFields as any, { transaction: t });

      if (data.logoUrl !== undefined) {
        await deleteS3ObjectIfReplaced(vendor.logoUrl, data.logoUrl);
      }
      if (data.bannerUrl !== undefined) {
        await deleteS3ObjectIfReplaced(vendor.bannerUrl, data.bannerUrl);
      }
    });

    // Reload after commit — uncommitted vendor_categories are invisible on another connection.
    return this.getVendorById(vendorId);
  }

  async getKycChecklist(vendorId: string) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');
    return buildKycChecklist(vendorId, vendor.entityType);
  }

  async getMyKycChecklist(userVendorId: string | null | undefined) {
    if (!userVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    return this.getKycChecklist(userVendorId);
  }

  async approveVendor(vendorId: string, data: ApproveVendorRequest, actorId: string) {
    const checklist = await buildKycChecklist(
      vendorId,
      (await vendorsRepository.findById(vendorId))?.entityType,
    );
    if (!checklist.isComplete) {
      throw new AppError(ERROR_MESSAGES.VENDOR_KYC_INCOMPLETE, 422, ERROR_CODES.VENDOR_KYC_INCOMPLETE);
    }

    await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_PENDING);
      }

      await vendorsRepository.update(
        vendorId,
        {
          status: VENDOR_STATUS.APPROVED,
          commissionRate: data.commissionRate ?? vendor.commissionRate,
          rejectionReason: null,
          suspensionReason: null,
        },
        { transaction: t },
      );
    });

    const updated = await this.getVendorById(vendorId);
    await logAudit({
      actorId,
      action: 'VENDOR_APPROVE',
      entityType: 'Vendor',
      entityId: vendorId,
      metadata: { commissionRate: data.commissionRate ?? null },
    });
    const ownerId = await findVendorOwnerUserId(vendorId);
    if (ownerId) {
      void notificationsService.sendVendorApproved(ownerId, vendorId, {
        businessName: updated.businessName,
      });
    }
    return updated;
  }

  async rejectVendor(vendorId: string, data: RejectVendorRequest, actorId: string) {
    await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.VENDOR_NOT_PENDING);
      }

      await vendorsRepository.update(
        vendorId,
        {
          status: VENDOR_STATUS.REJECTED,
          rejectionReason: data.reason,
        },
        { transaction: t },
      );
    });

    const updated = await this.getVendorById(vendorId);
    await logAudit({
      actorId,
      action: 'VENDOR_REJECT',
      entityType: 'Vendor',
      entityId: vendorId,
      metadata: { reason: data.reason },
    });
    const ownerId = await findVendorOwnerUserId(vendorId);
    if (ownerId) {
      void notificationsService.sendVendorRejected(ownerId, vendorId, {
        businessName: updated.businessName,
        reason: data.reason,
      });
    }
    return updated;
  }

  async suspendVendor(vendorId: string, data: SuspendVendorRequest, actorId: string) {
    await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      await vendorsRepository.update(
        vendorId,
        {
          status: VENDOR_STATUS.SUSPENDED,
          suspensionReason: data.reason,
        },
        { transaction: t },
      );
    });

    const updated = await this.getVendorById(vendorId);
    await logAudit({
      actorId,
      action: 'VENDOR_SUSPEND',
      entityType: 'Vendor',
      entityId: vendorId,
      metadata: { reason: data.reason },
    });
    const ownerId = await findVendorOwnerUserId(vendorId);
    if (ownerId) {
      void notificationsService.sendVendorSuspended(ownerId, vendorId, {
        businessName: updated.businessName,
        reason: data.reason,
      });
    }
    return updated;
  }

  async unsuspendVendor(vendorId: string, actorId: string) {
    await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');
      if (vendor.status !== VENDOR_STATUS.SUSPENDED) {
        throw new ValidationError('Only suspended vendors can be unsuspended');
      }

      await vendorsRepository.update(
        vendorId,
        {
          status: VENDOR_STATUS.APPROVED,
          suspensionReason: null,
        },
        { transaction: t },
      );
    });

    const updated = await this.getVendorById(vendorId);
    await logAudit({
      actorId,
      action: 'VENDOR_UNSUSPEND',
      entityType: 'Vendor',
      entityId: vendorId,
      metadata: {},
    });
    const ownerId = await findVendorOwnerUserId(vendorId);
    if (ownerId) {
      void notificationsService.sendVendorApproved(ownerId, vendorId, {
        businessName: updated.businessName,
      });
    }
    return updated;
  }

  async uploadDocument(vendorId: string, data: UploadDocumentRequest) {
    const { document, previousUrl } = await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      const existing = await VendorDocument.findOne({
        where: { vendorId, type: data.type },
        transaction: t,
      });

      if (existing) {
        const previousUrl = existing.url;
        await existing.update(
          {
            url: data.url,
            verified: false,
            verifiedById: null,
            // Clear rejectedAt so checklist returns to PENDING_REVIEW; keep reason visible.
            rejectedAt: null,
          },
          { transaction: t },
        );
        return { document: existing, previousUrl };
      }

      const created = await VendorDocument.create(
        {
          vendorId,
          type: data.type,
          url: data.url,
          verified: false,
          verifiedById: null,
          rejectionReason: null,
          rejectedAt: null,
        },
        { transaction: t },
      );
      return { document: created, previousUrl: null as string | null };
    });

    await deleteS3ObjectIfReplaced(previousUrl, data.url);
    return document;
  }

  async getVendorDocuments(vendorId: string) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');

    return VendorDocument.findAll({ where: { vendorId } });
  }

  async uploadMyDocument(userVendorId: string | null | undefined, data: UploadDocumentRequest) {
    if (!userVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    return this.uploadDocument(userVendorId, data);
  }

  async getMyDocuments(userVendorId: string | null | undefined) {
    if (!userVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    return this.getVendorDocuments(userVendorId);
  }

  async deleteVendor(vendorId: string, actorId?: string) {
    const media = await sequelize.transaction(async (t) => {
      const vendor = await vendorsRepository.findById(vendorId, { transaction: t });
      if (!vendor) throw new NotFoundError('Vendor');

      const activeSubOrdersCount = await SubOrder.count({
        where: {
          vendorId,
          status: {
            [Op.in]: [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED],
          },
        },
        transaction: t,
      });

      if (activeSubOrdersCount > 0) {
        throw new ValidationError(
          'Cannot delete vendor with active suborders in progress. Settle or cancel all active orders first.',
        );
      }

      await Product.update(
        { status: PRODUCT_STATUS.ARCHIVED },
        {
          where: {
            vendorId,
            status: { [Op.ne]: PRODUCT_STATUS.ARCHIVED },
          },
          transaction: t,
        },
      );

      const docs = await VendorDocument.findAll({
        where: { vendorId },
        attributes: ['url'],
        transaction: t,
        paranoid: false,
      });

      await VendorDocument.destroy({ where: { vendorId }, transaction: t });
      await VendorCategory.destroy({ where: { vendorId }, transaction: t });
      await vendorsRepository.softDelete(vendorId, { transaction: t });

      if (actorId) {
        await logAudit({
          actorId,
          action: 'VENDOR_DELETED',
          entityType: 'Vendor',
          entityId: vendorId,
          metadata: { businessName: vendor.businessName },
          transaction: t,
        });
      }

      return {
        urls: [vendor.logoUrl, vendor.bannerUrl, ...docs.map((d) => d.url)],
      };
    });

    await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.VENDORS, vendorId, media.urls);
  }

  async verifyDocument(documentId: string, actorId: string) {
    const document = await sequelize.transaction(async (t) => {
      const row = await VendorDocument.findByPk(documentId, { transaction: t });
      if (!row) throw new NotFoundError('VendorDocument');

      await row.update(
        {
          verified: true,
          verifiedById: actorId,
          rejectionReason: null,
          rejectedAt: null,
        },
        { transaction: t },
      );
      return row;
    });

    await logAudit({
      actorId,
      action: 'VENDOR_DOCUMENT_VERIFY',
      entityType: 'VendorDocument',
      entityId: document.id,
      metadata: { vendorId: document.vendorId, type: document.type },
    });
    return document;
  }

  async rejectDocument(
    documentId: string,
    data: RejectDocumentRequest,
    actorId: string,
  ): Promise<{ id: string; rejected: boolean; rejectionReason: string }> {
    const document = await sequelize.transaction(async (t) => {
      const row = await VendorDocument.findByPk(documentId, { transaction: t });
      if (!row) throw new NotFoundError('VendorDocument');
      await row.update(
        {
          verified: false,
          verifiedById: null,
          rejectionReason: data.reason,
          rejectedAt: new Date(),
        },
        { transaction: t },
      );
      return row;
    });

    await logAudit({
      actorId,
      action: 'VENDOR_DOCUMENT_REJECT',
      entityType: 'VendorDocument',
      entityId: document.id,
      metadata: {
        vendorId: document.vendorId,
        type: document.type,
        reason: data.reason,
      },
    });

    const ownerId = await findVendorOwnerUserId(document.vendorId);
    if (ownerId) {
      void notificationsService.sendKycDocumentRejected(ownerId, document.id, {
        reason: data.reason,
      });
    }
    return { id: document.id, rejected: true, rejectionReason: data.reason };
  }

  /** Used by products module to gate LIVE for category-specific KYC. */
  async assertCategoriesKycSatisfied(vendorId: string, categoryIds: string[]) {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');
    const ok = await areCategoryDocumentsSatisfied(vendorId, vendor.entityType, categoryIds);
    if (!ok) {
      throw new AppError(
        ERROR_MESSAGES.VENDOR_KYC_BLOCKS_PRODUCT,
        422,
        ERROR_CODES.VENDOR_KYC_BLOCKS_PRODUCT,
      );
    }
  }

  /**
   * Returns a short-lived signed GET URL for a KYC document.
   * Allowed for the owning vendor or admins with vendor manage/approve.
   */
  async getDocumentViewUrl(
    documentId: string,
    actor: { vendorId?: string | null; roleId: string; role: { name: string } },
  ) {
    const document = await VendorDocument.findByPk(documentId);
    if (!document) throw new NotFoundError('VendorDocument');

    const ownsDocument = Boolean(actor.vendorId && actor.vendorId === document.vendorId);
    if (!ownsDocument) {
      const perms = await resolvePermissionsForUser(actor);
      const canManage = perms.some(
        (key) => key === PERMISSIONS.VENDOR_MANAGE || key === PERMISSIONS.VENDOR_APPROVE,
      );
      if (!canManage) {
        throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
      }
    }

    const key = extractS3KeyFromUrl(document.url);
    if (!key) {
      return { url: document.url };
    }
    const url = await signedGetObjectUrl(key);
    return { url };
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
    // Same net-payout definition the admin settlement report uses, so the two agree.
    const [payout] = await sequelize.query<{ pendingPaise: string | null }>(
      `SELECT COALESCE(SUM(${sqlVendorNetPayoutPaise('cl')}), 0)::bigint AS "pendingPaise"
       FROM commission_ledgers cl
       WHERE cl."vendorId" = :vendorId AND cl.status = :pending`,
      {
        replacements: { vendorId, pending: COMMISSION_STATUS.PENDING },
        type: QueryTypes.SELECT,
      },
    );
    return {
      todayOrders: Number(today?.orders ?? 0),
      pendingShipments: Number(pending?.shipments ?? 0),
      monthRevenue: Number(month?.revenue ?? 0),
      pendingPayouts: fromPaise(Number(payout?.pendingPaise ?? 0)),
      performanceScore: vendor.performanceScore == null ? null : Number(vendor.performanceScore),
    };
  }

  /**
   * Vendor sales analytics for `VendorAnalytics` (revenue trend, top products,
   * fulfillment SLA). Trailing `windowDays` window, defaulting to 30.
   *
   * "On time" delivery has no existing platform-wide SLA constant to reuse, so this
   * defines one locally (`VENDOR_FULFILLMENT_SLA_HOURS`, 72h / 3 days from suborder
   * creation to delivery) — the same createdAt→updatedAt "hours to deliver" measure
   * the `vendor-fulfillment-sla` report already computes, just bucketed on/off time.
   */
  async getDashboardAnalytics(
    vendorId: string,
    windowDays = 30,
  ): Promise<{
    revenue: { date: string; amount: number }[];
    topProducts: { id: string; name: string; unitsSold: number; revenue: number }[];
    fulfillmentSLA: { onTimePercent: number; latePercent: number };
  }> {
    const vendor = await vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');

    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (windowDays - 1));
    from.setUTCHours(0, 0, 0, 0);

    const subtotalPaiseExpr = sqlFrozenPaise('s', 'subtotalPaise', 'subtotal');

    const revenueRows = await sequelize.query<{ day: string; revenuePaise: string }>(
      `WITH days AS (
         SELECT generate_series(:from::date, :to::date, interval '1 day')::date AS day
       ),
       daily_revenue AS (
         SELECT date_trunc('day', o."createdAt")::date AS day,
                SUM(${subtotalPaiseExpr}) AS "revenuePaise"
         FROM sub_orders s
         INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
         WHERE s."vendorId" = :vendorId
           AND s."deletedAt" IS NULL
           AND o."createdAt" BETWEEN :from AND :to
           AND ${REPORTABLE_ORDER_SQL}
         GROUP BY 1
       )
       SELECT d.day::text AS day, COALESCE(r."revenuePaise", 0)::bigint AS "revenuePaise"
       FROM days d
       LEFT JOIN daily_revenue r ON r.day = d.day
       ORDER BY d.day ASC`,
      { replacements: { vendorId, from, to }, type: QueryTypes.SELECT },
    );

    const topProductRows = await sequelize.query<{
      productId: string;
      name: string;
      unitsSold: string;
      revenue: string;
    }>(
      `SELECT pv."productId" AS "productId",
              (ARRAY_AGG(oi."productName" ORDER BY oi."createdAt" DESC))[1] AS "name",
              SUM(oi.quantity)::int AS "unitsSold",
              SUM(COALESCE(oi."lineSubtotal", oi."unitPrice" * oi.quantity))::numeric AS "revenue"
       FROM order_items oi
       INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
       INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
       INNER JOIN product_variants pv ON pv.id = oi."variantId"
       WHERE s."vendorId" = :vendorId
         AND oi."deletedAt" IS NULL
         AND o."createdAt" BETWEEN :from AND :to
         AND ${REPORTABLE_ORDER_SQL}
       GROUP BY pv."productId"
       ORDER BY revenue DESC
       LIMIT 10`,
      { replacements: { vendorId, from, to }, type: QueryTypes.SELECT },
    );

    const [sla] = await sequelize.query<{ delivered: string; onTime: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = :delivered) AS delivered,
         COUNT(*) FILTER (
           WHERE status = :delivered
             AND EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 3600 <= :slaHours
         ) AS "onTime"
       FROM sub_orders
       WHERE "vendorId" = :vendorId
         AND "deletedAt" IS NULL
         AND "createdAt" BETWEEN :from AND :to`,
      {
        replacements: {
          vendorId,
          from,
          to,
          delivered: ORDER_STATUS.DELIVERED,
          slaHours: VENDOR_FULFILLMENT_SLA_HOURS,
        },
        type: QueryTypes.SELECT,
      },
    );

    const deliveredCount = Number(sla?.delivered ?? 0);
    const onTimeCount = Number(sla?.onTime ?? 0);
    const onTimePercent = deliveredCount > 0 ? Math.round((onTimeCount / deliveredCount) * 10000) / 100 : 0;
    const latePercent = deliveredCount > 0 ? Math.round(((deliveredCount - onTimeCount) / deliveredCount) * 10000) / 100 : 0;

    return {
      revenue: revenueRows.map((row) => ({
        date: row.day,
        amount: fromPaise(Number(row.revenuePaise ?? 0)),
      })),
      topProducts: topProductRows.map((row) => ({
        id: row.productId,
        name: row.name ?? '',
        unitsSold: Number(row.unitsSold ?? 0),
        revenue: Number(row.revenue ?? 0),
      })),
      fulfillmentSLA: { onTimePercent, latePercent },
    };
  }
}

export const vendorsService = new VendorsService();
