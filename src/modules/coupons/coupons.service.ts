import { Op } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { CouponBatch } from '@database/models/couponBatch.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { NotificationLog } from '@database/models/notificationLog.model';
import { sequelize } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import {
  COUPON_STATUS,
  DISCOUNT_BEARER,
  NOTIFICATION_STATUS,
  VENDOR_STATUS,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { logAudit } from '@modules/audit/audit.service';
import {
  validateCoupon,
  type CartLineForCoupon,
} from './couponEngine';
import { generateCouponCode } from './coupon.utils';
import type {
  BulkGenerateRequest,
  CreateCouponRequest,
  ListCouponsQuery,
  UpdateCouponRequest,
  CouponStatusRequest,
} from './coupons.dto';

async function loadCartLines(userId: string): Promise<{
  cart: Cart | null;
  lines: CartLineForCoupon[];
}> {
  const cart = await Cart.findOne({
    where: { userId },
    include: [
      {
        model: CartItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            include: [
              {
                model: Product,
                as: 'product',
                include: [{ model: Vendor, as: 'vendor' }],
              },
            ],
          },
        ],
      },
    ],
  });

  const items = ((cart as any)?.items ?? []).filter((item: any) => {
    const product = item.variant?.product;
    const vendor = product?.vendor ?? product?.Vendor ?? null;
    return resolveItemAvailability({
      product,
      vendor,
      stock: Number(item.variant?.stock ?? 0),
      quantity: Number(item.quantity ?? 0),
    }).isAvailable;
  });

  const lines: CartLineForCoupon[] = items.map((item: any) => {
    const product = item.variant?.product;
    return {
      productId: String(product?.id ?? ''),
      categoryId: product?.categoryId ? String(product.categoryId) : null,
      vendorId: product?.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant?.price ?? 0),
      quantity: Number(item.quantity ?? 0),
    };
  });

  return { cart, lines };
}

function resolveCreateDefaults(
  dto: CreateCouponRequest,
  opts: { forceVendorId?: string | null },
): {
  vendorId: string | null;
  discountBearer: 'PLATFORM' | 'VENDOR';
  applicableScope: { type: 'all' | 'vendor' | 'product' | 'category'; ids: string[] };
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
} {
  const vendorId = opts.forceVendorId ?? dto.vendorId ?? null;
  const discountBearer =
    dto.discountBearer ??
    (vendorId ? DISCOUNT_BEARER.VENDOR : DISCOUNT_BEARER.PLATFORM);

  let applicableScope: { type: 'all' | 'vendor' | 'product' | 'category'; ids: string[] } =
    dto.applicableScope ?? { type: 'all', ids: [] };
  if (vendorId) {
    if (applicableScope.type === 'product' || applicableScope.type === 'category') {
      // keep product/category ids; vendorId on coupon still constrains at validate time
    } else {
      applicableScope = { type: 'vendor', ids: [vendorId] };
    }
  }

  return {
    vendorId,
    discountBearer,
    applicableScope,
    status: dto.status ?? COUPON_STATUS.ACTIVE,
  };
}

export class CouponsService {
  async createCoupon(
    dto: CreateCouponRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<Coupon> {
    if (opts.forceVendorId) {
      const vendor = await Vendor.findByPk(opts.forceVendorId);
      if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
        throw new AppError(ERROR_MESSAGES.VENDOR_UNAVAILABLE, 422, ERROR_CODES.VENDOR_UNAVAILABLE);
      }
    }

    const defaults = resolveCreateDefaults(dto, opts);
    const coupon = await Coupon.create({
      code: dto.code.toUpperCase(),
      type: dto.type,
      value: dto.value ?? null,
      maxDiscountCap: dto.maxDiscountCap ?? null,
      minOrderValue: dto.minOrderValue ?? null,
      minQuantity: dto.minQuantity ?? null,
      applicableScope: defaults.applicableScope,
      excludedItems: {
        productIds: dto.excludedItems?.productIds ?? [],
        categoryIds: dto.excludedItems?.categoryIds ?? [],
      },
      userRestriction: dto.userRestriction ?? { type: 'all' },
      usageLimitTotal: dto.usageLimitTotal ?? null,
      usageLimitPerUser: dto.usageLimitPerUser ?? 1,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      stackable: dto.stackable ?? false,
      priority: dto.priority ?? 0,
      status: defaults.status,
      discountBearer: defaults.discountBearer,
      vendorId: defaults.vendorId,
      batchId: null,
      createdById: actorId,
      updatedBy: null,
      deletedBy: null,
    });

    await logAudit({
      actorId,
      action: 'COUPON_CREATE',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code, vendorId: coupon.vendorId },
    });

    return coupon;
  }

  async updateCoupon(
    id: string,
    dto: UpdateCouponRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<Coupon> {
    const coupon = await Coupon.findByPk(id);
    if (!coupon) throw new NotFoundError('Coupon');
    if (opts.forceVendorId && coupon.vendorId !== opts.forceVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
    }

    const patch: Record<string, unknown> = { updatedBy: actorId };
    if (dto.code != null) patch.code = dto.code.toUpperCase();
    if (dto.type != null) patch.type = dto.type;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.maxDiscountCap !== undefined) patch.maxDiscountCap = dto.maxDiscountCap;
    if (dto.minOrderValue !== undefined) patch.minOrderValue = dto.minOrderValue;
    if (dto.minQuantity !== undefined) patch.minQuantity = dto.minQuantity;
    if (dto.excludedItems !== undefined) patch.excludedItems = dto.excludedItems;
    if (dto.userRestriction !== undefined) patch.userRestriction = dto.userRestriction;
    if (dto.usageLimitTotal !== undefined) patch.usageLimitTotal = dto.usageLimitTotal;
    if (dto.usageLimitPerUser !== undefined) patch.usageLimitPerUser = dto.usageLimitPerUser;
    if (dto.startDate != null) patch.startDate = new Date(dto.startDate);
    if (dto.endDate != null) patch.endDate = new Date(dto.endDate);
    if (dto.stackable !== undefined) patch.stackable = dto.stackable;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.status != null) patch.status = dto.status;

    if (opts.forceVendorId) {
      patch.vendorId = opts.forceVendorId;
      patch.discountBearer = DISCOUNT_BEARER.VENDOR;
      if (dto.applicableScope) {
        patch.applicableScope =
          dto.applicableScope.type === 'product' || dto.applicableScope.type === 'category'
            ? dto.applicableScope
            : { type: 'vendor', ids: [opts.forceVendorId] };
      }
    } else {
      if (dto.vendorId !== undefined) patch.vendorId = dto.vendorId;
      if (dto.discountBearer != null) patch.discountBearer = dto.discountBearer;
      if (dto.applicableScope != null) patch.applicableScope = dto.applicableScope;
    }

    await coupon.update(patch);
    await logAudit({
      actorId,
      action: 'COUPON_UPDATE',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code },
    });
    return coupon;
  }

  async listCoupons(query: ListCouponsQuery, opts: { forceVendorId?: string | null } = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = paginationOffset(page, limit);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.batchId) where.batchId = query.batchId;
    if (opts.forceVendorId) where.vendorId = opts.forceVendorId;
    else if (query.vendorId) where.vendorId = query.vendorId;
    else if (query.vendorScoped === true) where.vendorId = { [Op.ne]: null };
    else if (query.vendorScoped === false) where.vendorId = null;

    const { rows, count } = await Coupon.findAndCountAll({
      where,
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });
    return {
      coupons: rows,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async getById(id: string, opts: { forceVendorId?: string | null } = {}): Promise<Coupon> {
    const coupon = await Coupon.findByPk(id);
    if (!coupon) throw new NotFoundError('Coupon');
    if (opts.forceVendorId && coupon.vendorId !== opts.forceVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
    }
    return coupon;
  }

  async analytics(
    id: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<{
    couponId: string;
    code: string;
    usedCount: number;
    totalDiscount: number;
    usedCountCached: number;
    usageLimitTotal: number | null;
  }> {
    const coupon = await this.getById(id, opts);
    const usedCount = await CouponUsage.count({ where: { couponId: coupon.id } });
    const totalDiscount =
      (await CouponUsage.sum('discountApplied', { where: { couponId: coupon.id } })) ?? 0;
    return {
      couponId: coupon.id,
      code: coupon.code,
      usedCount,
      totalDiscount: Number(totalDiscount),
      usedCountCached: Number(coupon.usedCount ?? 0),
      usageLimitTotal: coupon.usageLimitTotal == null ? null : Number(coupon.usageLimitTotal),
    };
  }

  /** Vendor-borne discount cost absorbed across this vendor's coupons. */
  async vendorAbsorbedDiscountSummary(vendorId: string): Promise<{
    vendorId: string;
    absorbedDiscountTotal: number;
    couponCount: number;
  }> {
    const coupons = await Coupon.findAll({
      where: { vendorId, discountBearer: DISCOUNT_BEARER.VENDOR },
      attributes: ['id'],
    });
    const ids = coupons.map((row) => row.id);
    if (!ids.length) {
      return { vendorId, absorbedDiscountTotal: 0, couponCount: 0 };
    }
    const total =
      (await CouponUsage.sum('discountApplied', { where: { couponId: { [Op.in]: ids } } })) ?? 0;
    return {
      vendorId,
      absorbedDiscountTotal: Number(total),
      couponCount: ids.length,
    };
  }

  async setStatus(
    id: string,
    dto: CouponStatusRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<Coupon> {
    const coupon = await this.getById(id, opts);
    await coupon.update({ status: dto.status, updatedBy: actorId });
    await logAudit({
      actorId,
      action: `COUPON_${dto.status}`,
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code, status: dto.status },
    });
    return coupon;
  }

  async bulkGenerate(
    dto: BulkGenerateRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<{ batch: CouponBatch; coupons: Coupon[] }> {
    return sequelize.transaction(async (t) => {
      const template = dto.template;
      const defaults = resolveCreateDefaults(
        { ...template, code: 'BULK' } as CreateCouponRequest,
        opts,
      );
      const batch = await CouponBatch.create(
        {
          name: dto.name,
          templateCouponConfig: template as unknown as Record<string, unknown>,
          generatedCount: 0,
          createdById: actorId,
          createdBy: actorId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const created: Coupon[] = [];
      const prefix = (dto.prefix ?? 'CS').toUpperCase();
      for (let i = 0; i < dto.count; i++) {
        let code = generateCouponCode(prefix);
        for (let attempt = 0; attempt < 5; attempt++) {
          const exists = await Coupon.findOne({ where: { code }, transaction: t });
          if (!exists) break;
          code = generateCouponCode(prefix);
        }
        const coupon = await Coupon.create(
          {
            code,
            type: template.type,
            value: template.value ?? null,
            maxDiscountCap: template.maxDiscountCap ?? null,
            minOrderValue: template.minOrderValue ?? null,
            minQuantity: template.minQuantity ?? null,
            applicableScope: defaults.applicableScope,
            excludedItems: {
              productIds: template.excludedItems?.productIds ?? [],
              categoryIds: template.excludedItems?.categoryIds ?? [],
            },
            userRestriction: template.userRestriction ?? { type: 'all' },
            usageLimitTotal: 1,
            usageLimitPerUser: template.usageLimitPerUser ?? 1,
            startDate: new Date(template.startDate),
            endDate: new Date(template.endDate),
            stackable: template.stackable ?? false,
            priority: template.priority ?? 0,
            status: defaults.status,
            discountBearer: defaults.discountBearer,
            vendorId: defaults.vendorId,
            batchId: batch.id,
            createdById: actorId,
            updatedBy: null,
            deletedBy: null,
          },
          { transaction: t },
        );
        created.push(coupon);
      }

      await batch.update({ generatedCount: created.length, updatedBy: actorId }, { transaction: t });
      await logAudit({
        actorId,
        action: 'COUPON_BULK_GENERATE',
        entityType: 'CouponBatch',
        entityId: batch.id,
        metadata: { count: created.length, name: batch.name },
      });

      return { batch, coupons: created };
    });
  }

  async listBatches(opts: { forceVendorId?: string | null } = {}): Promise<CouponBatch[]> {
    const batches = await CouponBatch.findAll({
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    if (!opts.forceVendorId) return batches;

    const filtered: CouponBatch[] = [];
    for (const batch of batches) {
      const count = await Coupon.count({
        where: { batchId: batch.id, vendorId: opts.forceVendorId },
      });
      if (count > 0) filtered.push(batch);
    }
    return filtered;
  }

  async applyCoupon(code: string, userId: string) {
    const { cart, lines } = await loadCartLines(userId);
    if (!cart || lines.length === 0) {
      throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
    }

    const result = await validateCoupon({
      code,
      userId,
      lines,
      shippingTotal: 0,
      existingCouponCode: cart.couponCode,
    });

    if (!result.valid || !result.coupon) {
      throw new ValidationError(result.reason ?? ERROR_MESSAGES.COUPON_NOT_APPLICABLE);
    }

    await cart.update({ couponCode: result.coupon.code });

    return {
      code: result.coupon.code,
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      type: result.coupon.type,
      vendorDiscountShares: result.vendorDiscountShares,
    };
  }

  async removeCoupon(userId: string) {
    const cart = await Cart.findOne({ where: { userId } });
    if (!cart) return { cleared: false };
    await cart.update({ couponCode: null });
    return { cleared: true };
  }

  async revalidateCartCoupon(userId: string): Promise<{
    removed: boolean;
    reason: string | null;
    reasonCode: string | null;
    appliedCoupon: { code: string; discount: number; cashbackAmount: number; type: string } | null;
  }> {
    const { cart, lines } = await loadCartLines(userId);
    if (!cart?.couponCode) {
      return { removed: false, reason: null, reasonCode: null, appliedCoupon: null };
    }

    const result = await validateCoupon({
      code: cart.couponCode,
      userId,
      lines,
      shippingTotal: 0,
      existingCouponCode: null,
    });

    if (!result.valid || !result.coupon) {
      await cart.update({ couponCode: null });
      return {
        removed: true,
        reason: result.reason ?? ERROR_MESSAGES.COUPON_NOT_APPLICABLE,
        reasonCode: result.reasonCode,
        appliedCoupon: null,
      };
    }

    return {
      removed: false,
      reason: null,
      reasonCode: null,
      appliedCoupon: {
        code: result.coupon.code,
        discount: result.discount,
        cashbackAmount: result.cashbackAmount,
        type: result.coupon.type,
      },
    };
  }

  async eligibleCoupons(
    userId: string,
    limit = 5,
  ): Promise<
    Array<{
      code: string;
      type: string;
      discount: number;
      cashbackAmount: number;
      priority: number;
    }>
  > {
    const { lines } = await loadCartLines(userId);
    if (lines.length === 0) return [];

    const now = new Date();
    const candidates = await Coupon.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now },
      },
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit: 50,
    });

    const eligible: Array<{
      code: string;
      type: string;
      discount: number;
      cashbackAmount: number;
      priority: number;
    }> = [];
    for (const coupon of candidates) {
      const result = await validateCoupon({
        coupon,
        userId,
        lines,
        shippingTotal: 0,
      });
      if (result.valid) {
        eligible.push({
          code: coupon.code,
          type: coupon.type,
          discount: result.discount,
          cashbackAmount: result.cashbackAmount,
          priority: Number(coupon.priority ?? 0),
        });
      }
      if (eligible.length >= limit) break;
    }
    return eligible;
  }

  async notifyExpiringAndNearLimit() {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const coupons = await Coupon.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        vendorId: { [Op.ne]: null },
        [Op.or]: [
          { endDate: { [Op.between]: [now, inThreeDays] } },
          {
            usageLimitTotal: { [Op.ne]: null },
          },
        ],
      },
      limit: 200,
    });

    const created: NotificationLog[] = [];
    for (const coupon of coupons) {
      if (!coupon.vendorId) continue;
      const owner = await User.findOne({ where: { vendorId: coupon.vendorId } });
      if (!owner) continue;

      const nearLimit =
        coupon.usageLimitTotal != null &&
        (coupon.usedCount ?? 0) >= Math.ceil(Number(coupon.usageLimitTotal) * 0.8);
      const expiring = coupon.endDate <= inThreeDays && coupon.endDate >= now;

      if (nearLimit) {
        const log = await NotificationLog.create({
          userId: owner.id,
          type: 'COUPON_USAGE_LIMIT',
          referenceType: 'Coupon',
          referenceId: coupon.id,
          channel: 'EMAIL',
          status: NOTIFICATION_STATUS.PENDING,
          createdBy: owner.id,
        });
        created.push(log);
      }
      if (expiring) {
        const log = await NotificationLog.create({
          userId: owner.id,
          type: 'COUPON_EXPIRING',
          referenceType: 'Coupon',
          referenceId: coupon.id,
          channel: 'EMAIL',
          status: NOTIFICATION_STATUS.PENDING,
          createdBy: owner.id,
        });
        created.push(log);

        // Customer marketing only with consent — skip if no saved-coupon linkage yet
        if (owner.emailMarketingConsent) {
          // vendor owners aren't the marketing audience; customer offers need consent field (present on User)
        }
      }
    }

    return { notified: created.length };
  }
}

export const couponsService = new CouponsService();
