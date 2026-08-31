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
import { Order } from '@database/models/order.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { sequelize } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import {
  COUPON_STATUS,
  DISCOUNT_BEARER,
  VENDOR_STATUS,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability, isProductCustomerVisible } from '@core/catalog/customerVisibility';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { coerceRupees, roundMoney } from '@modules/pricing/money';
import { logAudit } from '@modules/audit/audit.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  validateCoupon,
  validateCouponSet,
  resolveCartCouponCodes,
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

async function previewShippingTotal(): Promise<number> {
  const cheapest = await ShippingRate.findOne({
    order: [['price', 'ASC']],
    attributes: ['price'],
  });
  return Number(cheapest?.price ?? 0);
}

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
    const vendor = product?.vendor ?? product?.Vendor ?? null;
    const availability = resolveItemAvailability({
      product,
      vendor,
      stock: Number(item.variant?.stock ?? 0),
      quantity: Number(item.quantity ?? 0),
    });
    return {
      productId: String(product?.id ?? ''),
      categoryId: product?.categoryId ? String(product.categoryId) : null,
      vendorId: product?.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant?.price ?? 0),
      quantity: Number(item.quantity ?? 0),
      isCustomerVisible: availability.isAvailable,
    };
  });

  return { cart, lines };
}

/** Single-product lines for PDP eligible-offer preview (qty 1, primary variant price). */
async function loadProductPreviewLines(productId: string): Promise<CartLineForCoupon[]> {
  const product = await Product.findByPk(productId, {
    include: [
      { model: Vendor, as: 'vendor' },
      { model: ProductVariant, as: 'variants' },
    ],
  });
  if (!product) return [];
  const vendor = (product as Product & { vendor?: Vendor }).vendor ?? null;
  if (!isProductCustomerVisible(product, vendor)) return [];

  const variants = ((product as Product & { variants?: ProductVariant[] }).variants ?? []).slice();
  variants.sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
  const variant = variants[0];
  if (!variant) return [];

  const quantity = 1;
  const availability = resolveItemAvailability({
    product,
    vendor,
    stock: Number(variant.stock ?? 0),
    quantity,
  });
  if (!availability.isAvailable) return [];

  return [
    {
      productId: String(product.id),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(variant.price ?? product.basePrice ?? 0),
      quantity,
      isCustomerVisible: true,
    },
  ];
}

async function assertVendorOwnsScopeProducts(
  vendorId: string,
  scope: { type: string; ids: string[] } | undefined,
) {
  if (!scope || scope.type !== 'product' || !scope.ids?.length) return;
  const products = await Product.findAll({
    where: { id: { [Op.in]: scope.ids } },
    attributes: ['id', 'vendorId'],
  });
  if (products.length !== scope.ids.length) {
    throw new ValidationError(ERROR_MESSAGES.COUPON_SCOPE);
  }
  if (products.some((product) => String(product.vendorId) !== vendorId)) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
  }
}

function resolveCreateDefaults(
  dto: CreateCouponRequest,
  opts: { forceVendorId?: string | null },
): {
  vendorId: string | null;
  discountBearer: 'PLATFORM' | 'VENDOR';
  applicableScope: { type: 'all' | 'vendor' | 'product' | 'category'; ids: string[] };
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED' | 'REJECTED';
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

function mapCouponResponse(coupon: Coupon) {
  const plain = typeof coupon.get === 'function' ? coupon.get({ plain: true }) : coupon;
  return {
    ...plain,
    value: plain.value != null ? roundMoney(plain.value) : null,
    maxDiscountCap: plain.maxDiscountCap != null ? roundMoney(plain.maxDiscountCap) : null,
    minOrderValue: plain.minOrderValue != null ? roundMoney(plain.minOrderValue) : null,
    minQuantity: plain.minQuantity != null ? Math.trunc(coerceRupees(plain.minQuantity)) : null,
    usageLimitTotal:
      plain.usageLimitTotal != null ? Math.trunc(coerceRupees(plain.usageLimitTotal)) : null,
    usageLimitPerUser: Math.trunc(coerceRupees(plain.usageLimitPerUser ?? 1)),
    usedCount: Math.trunc(coerceRupees(plain.usedCount ?? 0)),
    priority: Math.trunc(coerceRupees(plain.priority ?? 0)),
  };
}

type CouponResponse = ReturnType<typeof mapCouponResponse>;

async function findCouponOrThrow(id: string, opts: { forceVendorId?: string | null } = {}) {
  const coupon = await Coupon.findByPk(id);
  if (!coupon) throw new NotFoundError('Coupon');
  if (opts.forceVendorId && coupon.vendorId !== opts.forceVendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT);
  }
  return coupon;
}

export class CouponsService {
  async createCoupon(
    dto: CreateCouponRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<CouponResponse> {
    if (opts.forceVendorId) {
      const vendor = await Vendor.findByPk(opts.forceVendorId);
      if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
        throw new AppError(ERROR_MESSAGES.VENDOR_UNAVAILABLE, 422, ERROR_CODES.VENDOR_UNAVAILABLE);
      }
    }

    const defaults = resolveCreateDefaults(dto, opts);
    if (opts.forceVendorId) {
      await assertVendorOwnsScopeProducts(opts.forceVendorId, defaults.applicableScope);
    }

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
      config: dto.config ?? {},
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

    return mapCouponResponse(coupon);
  }

  async updateCoupon(
    id: string,
    dto: UpdateCouponRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<CouponResponse> {
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
    if (dto.config !== undefined) patch.config = dto.config;
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
        await assertVendorOwnsScopeProducts(
          opts.forceVendorId,
          patch.applicableScope as { type: string; ids: string[] },
        );
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
    return mapCouponResponse(coupon);
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
      coupons: rows.map(mapCouponResponse),
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async getById(id: string, opts: { forceVendorId?: string | null } = {}) {
    const coupon = await findCouponOrThrow(id, opts);
    return mapCouponResponse(coupon);
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
    revenueImpact: number;
    conversionRate: number | null;
  }> {
    const coupon = await this.getById(id, opts);
    const usedCount = await CouponUsage.count({ where: { couponId: coupon.id } });
    const totalDiscount =
      (await CouponUsage.sum('discountApplied', { where: { couponId: coupon.id } })) ?? 0;

    const usages = await CouponUsage.findAll({
      where: { couponId: coupon.id },
      attributes: ['orderId'],
    });
    const orderIds = [...new Set(usages.map((row) => row.orderId))];
    let revenueImpact = 0;
    if (orderIds.length > 0) {
      revenueImpact = Number(
        (await Order.sum('totalAmount', { where: { id: { [Op.in]: orderIds } } })) ?? 0,
      );
    }

    const limit = coupon.usageLimitTotal == null ? null : Number(coupon.usageLimitTotal);
    const conversionRate =
      limit != null && limit > 0 ? Math.min(1, usedCount / limit) : usedCount > 0 ? 1 : 0;

    return {
      couponId: coupon.id,
      code: coupon.code,
      usedCount,
      totalDiscount: Number(totalDiscount),
      usedCountCached: Number(coupon.usedCount ?? 0),
      usageLimitTotal: limit,
      revenueImpact,
      conversionRate,
    };
  }

  /** Vendor-borne discount cost absorbed this calendar month (UTC). */
  async vendorAbsorbedDiscountSummary(vendorId: string): Promise<{
    vendorId: string;
    absorbedDiscountTotal: number;
    couponCount: number;
    periodStart: string;
    periodEnd: string;
  }> {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const coupons = await Coupon.findAll({
      where: { vendorId, discountBearer: DISCOUNT_BEARER.VENDOR },
      attributes: ['id'],
    });
    const ids = coupons.map((row) => row.id);
    if (!ids.length) {
      return {
        vendorId,
        absorbedDiscountTotal: 0,
        couponCount: 0,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      };
    }
    const total =
      (await CouponUsage.sum('discountApplied', {
        where: {
          couponId: { [Op.in]: ids },
          createdAt: { [Op.gte]: periodStart, [Op.lt]: periodEnd },
        },
      })) ?? 0;
    return {
      vendorId,
      absorbedDiscountTotal: Number(total),
      couponCount: ids.length,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    };
  }

  async setStatus(
    id: string,
    dto: CouponStatusRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<CouponResponse> {
    if (dto.status === COUPON_STATUS.REJECTED && opts.forceVendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
    }
    const coupon = await findCouponOrThrow(id, opts);
    if (dto.status === COUPON_STATUS.REJECTED && !coupon.vendorId) {
      throw new ValidationError(ERROR_MESSAGES.COUPON_NOT_APPLICABLE);
    }
    await coupon.update({ status: dto.status, updatedBy: actorId });
    await logAudit({
      actorId,
      action: `COUPON_${dto.status}`,
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code, status: dto.status },
    });
    return mapCouponResponse(coupon);
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
            config: template.config ?? {},
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

  async listBatches(opts: { forceVendorId?: string | null } = {}): Promise<
    Array<{
      id: string;
      name: string;
      templateCouponConfig: Record<string, unknown>;
      generatedCount: number;
      createdById: string;
      createdAt: Date;
      updatedAt?: Date;
      redemptionCount: number;
      discountTotal: number;
      revenueImpact: number;
      codes: string[];
      expiresAt: string | null;
    }>
  > {
    const batches = await CouponBatch.findAll({
      order: [['createdAt', 'DESC']],
      limit: 100,
    });

    const result = [];
    for (const batch of batches) {
      const couponWhere: Record<string, unknown> = { batchId: batch.id };
      if (opts.forceVendorId) couponWhere.vendorId = opts.forceVendorId;

      const coupons = await Coupon.findAll({
        where: couponWhere,
        attributes: ['id', 'code', 'usedCount', 'endDate'],
        order: [['code', 'ASC']],
      });
      if (opts.forceVendorId && coupons.length === 0) continue;

      const ids = coupons.map((row) => row.id);
      const redemptionCount =
        ids.length === 0
          ? 0
          : await CouponUsage.count({ where: { couponId: { [Op.in]: ids } } });
      const discountTotal =
        ids.length === 0
          ? 0
          : Number(
              (await CouponUsage.sum('discountApplied', {
                where: { couponId: { [Op.in]: ids } },
              })) ?? 0,
            );

      let revenueImpact = 0;
      if (ids.length > 0) {
        const usages = await CouponUsage.findAll({
          where: { couponId: { [Op.in]: ids } },
          attributes: ['orderId'],
        });
        const orderIds = [...new Set(usages.map((row) => row.orderId))];
        if (orderIds.length > 0) {
          revenueImpact = Number(
            (await Order.sum('totalAmount', { where: { id: { [Op.in]: orderIds } } })) ?? 0,
          );
        }
      }

      const expiresAt =
        coupons.length === 0
          ? null
          : coupons.reduce((earliest, row) => {
              const end = row.endDate;
              if (!earliest || end < earliest) return end;
              return earliest;
            }, null as Date | null);

      result.push({
        id: batch.id,
        name: batch.name,
        templateCouponConfig: batch.templateCouponConfig as Record<string, unknown>,
        generatedCount: batch.generatedCount,
        createdById: batch.createdById,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        redemptionCount,
        discountTotal,
        revenueImpact,
        codes: coupons.map((row) => row.code),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      });
    }
    return result;
  }

  async applyCoupon(code: string, userId: string) {
    const { cart, lines } = await loadCartLines(userId);
    if (!cart || lines.length === 0) {
      throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
    }

    const shippingTotal = await previewShippingTotal();
    const existingCodes = resolveCartCouponCodes(cart);
    const nextCode = code.trim().toUpperCase();
    const nextCodes = existingCodes.includes(nextCode)
      ? existingCodes
      : [...existingCodes, nextCode];

    const result = await validateCouponSet({
      codes: nextCodes,
      userId,
      lines,
      shippingTotal,
    });

    if (!result.valid || result.coupons.length === 0) {
      throw new ValidationError(result.reason ?? ERROR_MESSAGES.COUPON_NOT_APPLICABLE);
    }

    const codes = result.coupons.map((c) => c.code);
    await cart.update({
      couponCode: result.primaryCoupon?.code ?? codes[0] ?? null,
      couponCodes: codes,
    });

    return {
      code: result.primaryCoupon?.code ?? codes[0]!,
      codes,
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      type: result.primaryCoupon?.type ?? result.coupons[0]!.type,
      vendorDiscountShares: result.vendorDiscountShares,
    };
  }

  async removeCoupon(userId: string) {
    const cart = await Cart.findOne({ where: { userId } });
    if (!cart) return { cleared: false };
    await cart.update({ couponCode: null, couponCodes: [] });
    return { cleared: true };
  }

  async revalidateCartCoupon(userId: string): Promise<{
    removed: boolean;
    reason: string | null;
    reasonCode: string | null;
    appliedCoupon: {
      code: string;
      discount: number;
      cashbackAmount: number;
      type: string;
      vendorDiscountShares: Record<string, number>;
      vendorShippingDiscountShares: Record<string, number>;
      vendorBorneDiscountShares: Record<string, number>;
    } | null;
    appliedCoupons: Array<{
      code: string;
      discount: number;
      cashbackAmount: number;
      type: string;
    }>;
  }> {
    const { cart, lines } = await loadCartLines(userId);
    const codes = cart ? resolveCartCouponCodes(cart) : [];
    if (!cart || codes.length === 0) {
      return {
        removed: false,
        reason: null,
        reasonCode: null,
        appliedCoupon: null,
        appliedCoupons: [],
      };
    }

    const shippingTotal = await previewShippingTotal();
    const result = await validateCouponSet({
      codes,
      userId,
      lines,
      shippingTotal,
    });

    if (!result.valid || result.coupons.length === 0) {
      await cart.update({ couponCode: null, couponCodes: [] });
      return {
        removed: true,
        reason: result.reason ?? ERROR_MESSAGES.COUPON_NOT_APPLICABLE,
        reasonCode: result.reasonCode,
        appliedCoupon: null,
        appliedCoupons: [],
      };
    }

    const nextCodes = result.coupons.map((c) => c.code);
    await cart.update({
      couponCode: result.primaryCoupon?.code ?? nextCodes[0] ?? null,
      couponCodes: nextCodes,
    });

    return {
      removed: false,
      reason: null,
      reasonCode: null,
      appliedCoupon: {
        code: result.primaryCoupon?.code ?? nextCodes[0]!,
        discount: result.discount,
        cashbackAmount: result.cashbackAmount,
        type: result.primaryCoupon?.type ?? result.coupons[0]!.type,
        vendorDiscountShares: result.vendorDiscountShares,
        vendorShippingDiscountShares: result.vendorShippingDiscountShares,
        vendorBorneDiscountShares: result.vendorBorneDiscountShares,
      },
      appliedCoupons: result.coupons.map((coupon) => ({
        code: coupon.code,
        discount: result.discount,
        cashbackAmount: result.cashbackAmount,
        type: coupon.type,
      })),
    };
  }

  async eligibleCoupons(
    userId: string | null,
    opts: { limit?: number; productId?: string } = {},
  ): Promise<
    Array<{
      code: string;
      type: string;
      discount: number;
      cashbackAmount: number;
      priority: number;
    }>
  > {
    const limit = opts.limit ?? 5;
    const lines = opts.productId
      ? await loadProductPreviewLines(opts.productId)
      : userId
        ? (await loadCartLines(userId)).lines
        : [];
    if (lines.length === 0) return [];

    const shippingTotal = await previewShippingTotal();
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
        shippingTotal,
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
        [Op.or]: [
          { endDate: { [Op.between]: [now, inThreeDays] } },
          { usageLimitTotal: { [Op.ne]: null } },
        ],
      },
      limit: 200,
    });

    const created: unknown[] = [];
    for (const coupon of coupons) {
      const nearLimit =
        coupon.usageLimitTotal != null &&
        (coupon.usedCount ?? 0) >= Math.ceil(Number(coupon.usageLimitTotal) * 0.8);
      const expiring = coupon.endDate <= inThreeDays && coupon.endDate >= now;
      const templateData = {
        code: coupon.code,
        usedCount: coupon.usedCount ?? 0,
        usageLimit: coupon.usageLimitTotal,
        expiresAt: coupon.endDate.toISOString(),
      };

      if (coupon.vendorId && (nearLimit || expiring)) {
        const owner = await User.findOne({ where: { vendorId: coupon.vendorId } });
        if (owner) {
          if (nearLimit) {
            const log = await notificationsService.sendCouponUsageLimit(
              owner.id,
              coupon.id,
              templateData,
            );
            if (log) created.push(log);
          }
          if (expiring) {
            const log = await notificationsService.sendCouponExpiring(
              owner.id,
              coupon.id,
              templateData,
            );
            if (log) created.push(log);
          }
        }
      }

      if (expiring) {
        const usageRows = await CouponUsage.findAll({
          where: { couponId: coupon.id },
          attributes: ['userId'],
          limit: 2000,
        });
        const cartHolders = await Cart.findAll({
          where: { couponCode: coupon.code },
          attributes: ['userId'],
          limit: 2000,
        });
        const customerIds = [
          ...new Set(
            [
              ...usageRows.map((row) => row.userId),
              ...cartHolders.map((row) => row.userId),
            ].filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
        ];
        for (const customerId of customerIds.slice(0, 500)) {
          const log = await notificationsService.sendCouponOfferExpiring(
            customerId,
            coupon.id,
            templateData,
          );
          if (log) created.push(log);
        }
      }
    }

    return { notified: created.length };
  }
}

export const couponsService = new CouponsService();
