import { Op, QueryTypes, UniqueConstraintError, type Transaction } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { Address } from '@database/models/address.model';
import { CouponBatch } from '@database/models/couponBatch.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { sequelize } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import {
  COMMISSION_REFERENCE_TYPE,
  COUPON_STATUS,
  DISCOUNT_BEARER,
  VENDOR_STATUS,
  type CouponStatus,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability, isProductCustomerVisible } from '@core/catalog/customerVisibility';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { coerceRupees, fromPaise, roundMoney } from '@modules/pricing/money';
import { REPORTABLE_ORDER_SQL, sqlOrderKeptPaymentPaise } from '@modules/pricing/frozenMoneySql';
import { istStartOfMonth } from '@modules/pricing/istCalendar';
import {
  resolveCartShippingPreviewForCoupon,
  resolveProductShippingPreviewForCoupon,
  type CouponShippingPreview,
} from '@modules/cart/cartShippingPreview';
import { logAudit } from '@modules/audit/audit.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { env } from '@config/env';
import {
  validateCoupon,
  resolveCartCouponCodes,
  type CartLineForCoupon,
} from './couponEngine';
import { couponsReplacedBy, customerCouponName, generateCouponCode } from './coupon.utils';
import { evaluateCartCoupons, zeroBenefitMessage, type CartCouponState } from './couponCartState';
import { couponRejected } from './couponErrors';
import { canMoveCouponStatus, COUPON_FIELDS_NEEDING_REAPPROVAL } from './couponStatusRules';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';
import { sqlKeptCouponDiscountPaise } from './couponDiscountSql';
import { listCouponBatchViews, type CouponBatchView } from './couponBatchViews';
import { listCouponOffers, type CouponOffer } from './couponOffers';
import { sendCouponAlerts } from './couponAlerts';


/**
 * Discount given and customer payments on the orders that redeemed these coupons,
 * counting only orders the settlement reports count (REPORTABLE_ORDER_SQL) and each
 * order once even when it redeemed several of the coupons. Discount on a cancelled or
 * RTO'd part is left out, as its payment is (`sqlKeptCouponDiscountPaise`); payments
 * are net of return refunds (`sqlOrderKeptPaymentPaise`).
 */
async function couponUsageMoney(
  couponIds: string[],
): Promise<{ discountTotal: number; customerSavings: number; revenueImpact: number }> {
  if (couponIds.length === 0) return { discountTotal: 0, customerSavings: 0, revenueImpact: 0 };
  const [row] = await sequelize.query<{ discountPaise: string; savingsPaise: string; paymentPaise: string }>(
    `WITH usages AS (
       SELECT cu."orderId",
         SUM(${sqlKeptCouponDiscountPaise()})::bigint AS "discountPaise",
         SUM(${sqlKeptCouponDiscountPaise('COALESCE(cu."customerDiscountApplied", cu."discountApplied")')})::bigint AS "savingsPaise"
       FROM coupon_usages cu
       INNER JOIN coupons c ON c.id = cu."couponId"
       WHERE cu."couponId" IN (:couponIds)
         AND cu."deletedAt" IS NULL
       GROUP BY cu."orderId"
     )
     SELECT
       COALESCE(SUM(u."discountPaise"), 0)::bigint AS "discountPaise",
       COALESCE(SUM(u."savingsPaise"), 0)::bigint AS "savingsPaise",
       COALESCE(SUM(${sqlOrderKeptPaymentPaise('o')}), 0)::bigint AS "paymentPaise"
     FROM usages u
     INNER JOIN orders o ON o.id = u."orderId" AND o."deletedAt" IS NULL
     WHERE ${REPORTABLE_ORDER_SQL}`,
    { replacements: { couponIds }, type: QueryTypes.SELECT },
  );
  return {
    discountTotal: fromPaise(Number(row?.discountPaise ?? 0)),
    customerSavings: fromPaise(Number(row?.savingsPaise ?? 0)),
    revenueImpact: fromPaise(Number(row?.paymentPaise ?? 0)),
  };
}
import { assertValidCouponShape, type CouponShape } from './coupons.dto';
import type {
  BulkGenerateRequest,
  CreateCouponRequest,
  ListCouponsQuery,
  UpdateCouponRequest,
  CouponStatusRequest,
} from './coupons.dto';

async function previewShippingTotal(
  userId: string | null,
  lines: CartLineForCoupon[],
  productId?: string,
): Promise<CouponShippingPreview> {
  if (productId) {
    const productShipping = await resolveProductShippingPreviewForCoupon(
      userId,
      productId,
      lines[0]?.variantId,
      lines[0]?.vendorId ?? null,
    );
    if (productShipping != null) return productShipping;
  }
  if (userId && lines.length > 0) {
    return resolveCartShippingPreviewForCoupon(userId, lines);
  }
  const cheapest = await ShippingRate.findOne({
    order: [['price', 'ASC']],
    attributes: ['price'],
  });
  const total = Number(cheapest?.price ?? 0);
  const vendorId = lines[0]?.vendorId ?? 'platform';
  return { total, byVendor: lines.length > 0 ? { [vendorId]: total } : {}, unknown: true };
}

/** The state of the customer's default address ('' without one), as the cart preview bills to. */
async function defaultShippingState(userId: string | null): Promise<string> {
  if (!userId) return '';
  const address = await Address.findOne({
    where: { userId },
    order: [
      ['isDefault', 'DESC'],
      ['updatedAt', 'DESC'],
    ],
    attributes: ['state'],
  });
  return String(address?.state ?? '').trim();
}

/** Coupon lines at GST-inclusive prices (checkout imports coupons: loaded lazily). */
async function gstInclusiveCouponLines(
  lines: CartLineForCoupon[],
  shippingStateCode: string,
): Promise<CartLineForCoupon[]> {
  const { withGstInclusiveLineValues } = await import('@modules/checkout/gstInclusiveLines');
  return withGstInclusiveLineValues(lines, shippingStateCode);
}

async function loadCartLines(userId: string): Promise<{
  cart: Cart | null;
  lines: CartLineForCoupon[];
  /** A cart line left out as unavailable (out of stock, unpublished) — maybe for now. */
  hasUnavailable: boolean;
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
      variantId: String(item.variant?.id ?? item.variantId ?? ''),
      categoryId: product?.categoryId ? String(product.categoryId) : null,
      vendorId: product?.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant?.price ?? 0),
      quantity: Number(item.quantity ?? 0),
      weightGrams: Number(item.variant?.weightGrams ?? 500),
      isCustomerVisible: availability.isAvailable,
    };
  });

  // Coupons are set against the prices the customer sees, GST included, valued as the
  // cart bills them (to the customer's default address, as the cart preview is).
  return {
    cart,
    lines: await gstInclusiveCouponLines(lines, await defaultShippingState(userId)),
    hasUnavailable: items.length < ((cart as any)?.items ?? []).length,
  };
}

/** Single-product lines for PDP eligible-offer preview (qty 1, primary variant price). */
async function loadProductPreviewLines(
  productId: string,
  userId: string | null,
  variantId?: string,
): Promise<CartLineForCoupon[]> {
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
  // The variant being looked at; before one is chosen, the lowest price.
  const variant = variants.find((row) => row.id === variantId) ?? variants[0];
  if (!variant) return [];

  const quantity = 1;
  const availability = resolveItemAvailability({
    product,
    vendor,
    stock: Number(variant.stock ?? 0),
    quantity,
  });
  if (!availability.isAvailable) return [];

  return gstInclusiveCouponLines([
    {
      productId: String(product.id),
      variantId: String(variant.id),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(variant.price ?? product.basePrice ?? 0),
      quantity,
      weightGrams: Number(variant.weightGrams ?? 500),
      isCustomerVisible: true,
    },
  ], await defaultShippingState(userId));
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

type CreateDefaultsInput = Pick<CreateCouponRequest, 'vendorId' | 'applicableScope' | 'status'>;

function resolveCreateDefaults(
  dto: CreateDefaultsInput,
  opts: { forceVendorId?: string | null },
): {
  vendorId: string | null;
  discountBearer: 'PLATFORM' | 'VENDOR';
  applicableScope: { type: 'all' | 'vendor' | 'product' | 'category'; ids: string[] };
  status: CouponStatus;
} {
  const vendorId = opts.forceVendorId ?? dto.vendorId ?? null;

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
    discountBearer: couponBearerFor(vendorId),
    applicableScope,
    // A vendor's coupon waits for an admin; what a vendor sends for status is ignored.
    status: opts.forceVendorId ? COUPON_STATUS.PENDING_APPROVAL : (dto.status ?? COUPON_STATUS.ACTIVE),
  };
}

/** The owner pays: a vendor's coupon is vendor-funded, a platform coupon platform-funded. */
function couponBearerFor(vendorId: string | null | undefined): 'PLATFORM' | 'VENDOR' {
  return vendorId ? DISCOUNT_BEARER.VENDOR : DISCOUNT_BEARER.PLATFORM;
}

/** Bulk, specific-user and segment coupons are never advertised; others follow the setting. */
function resolveShowInOffers(input: {
  requested?: boolean;
  batchId?: string | null;
  restrictionType?: string | null;
}): boolean {
  const restriction = (input.restrictionType ?? 'all').toLowerCase();
  if (input.batchId || restriction === 'specific' || restriction === 'segment') return false;
  return input.requested ?? true;
}

/** A taken code gets a clear error on the code field, not a 500. */
async function withCodeConflictError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new AppError(ERROR_MESSAGES.COUPON_CODE_TAKEN, 409, ERROR_CODES.COUPON_CODE_TAKEN, {
        fieldErrors: { code: [ERROR_MESSAGES.COUPON_CODE_TAKEN] },
      });
    }
    throw error;
  }
}

/** Tell the owner when an admin rejects or approves their coupon. */
async function notifyVendorOfDecision(
  coupon: Coupon,
  from: CouponStatus,
  dto: CouponStatusRequest,
  opts: { forceVendorId?: string | null },
): Promise<void> {
  if (opts.forceVendorId || !coupon.vendorId) return;
  const rejected = dto.status === COUPON_STATUS.REJECTED;
  const approved = dto.status === COUPON_STATUS.ACTIVE && from === COUPON_STATUS.PENDING_APPROVAL;
  if (!rejected && !approved) return;
  const ownerId = await findVendorOwnerUserId(coupon.vendorId);
  if (!ownerId) return;
  // Timestamped: a coupon rejected, fixed and rejected again gets a second email.
  const referenceId = `${coupon.id}:${coupon.updatedAt.toISOString()}`;
  const templateData = { code: coupon.code, reason: dto.note ?? '', actionUrl: `${env.CLIENT_URL}/vendor/dashboard/coupons` };
  void notificationsService.sendCouponDecision(
    ownerId,
    rejected ? 'COUPON_REJECTED' : 'COUPON_APPROVED',
    referenceId,
    templateData,
  );
}

function mapCouponResponse(coupon: Coupon) {
  const plain = typeof coupon.get === 'function' ? coupon.get({ plain: true }) : coupon;
  const { Vendor: vendorRow, ...fields } = plain as typeof plain & {
    Vendor?: { businessName?: string } | null;
  };
  return {
    ...fields,
    vendorName: vendorRow?.businessName ?? null,
    value: plain.value != null ? roundMoney(plain.value) : null,
    maxDiscountCap: plain.maxDiscountCap != null ? roundMoney(plain.maxDiscountCap) : null,
    minOrderValue: plain.minOrderValue != null ? roundMoney(plain.minOrderValue) : null,
    minQuantity: plain.minQuantity != null ? Math.trunc(coerceRupees(plain.minQuantity)) : null,
    usageLimitTotal:
      plain.usageLimitTotal != null ? Math.trunc(coerceRupees(plain.usageLimitTotal)) : null,
    usageLimitPerUser:
      plain.usageLimitPerUser != null ? Math.trunc(coerceRupees(plain.usageLimitPerUser)) : null,
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

const NO_COUPONS = {
  appliedCoupon: null,
  appliedCoupons: [] as Array<{ code: string; name: string; discount: number; cashbackAmount: number; type: string; lineShares?: Record<string, number> }>,
  inactiveCoupons: [] as Array<{ code: string; name: string; reason: string; reasonCode: string | null }>,
};

/** Keep what applies and what may apply again; let go of coupons that can never work again. */
async function saveCartCoupons(cart: Cart, state: CartCouponState): Promise<void> {
  const applied = state.result.coupons.map((row) => row.code);
  const waiting = state.inactive.filter((row) => !row.dead).map((row) => row.code);
  const primary = state.result.primaryCoupon?.code ?? applied[0] ?? waiting[0] ?? null;
  await cart.update({ couponCode: primary, couponCodes: [...applied, ...waiting] });
}

function toCartCouponView(state: CartCouponState) {
  const { result } = state;
  const inactiveCoupons = state.inactive.map(({ code, name, reason, reasonCode }) => ({ code, name, reason, reasonCode }));
  if (!result.valid || result.coupons.length === 0) return { ...NO_COUPONS, inactiveCoupons };
  const primaryCode = result.primaryCoupon?.code ?? result.coupons[0]!.code;
  return {
    inactiveCoupons,
    appliedCoupon: {
      code: primaryCode,
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      type: result.primaryCoupon?.type ?? result.coupons[0]!.type,
      vendorDiscountShares: result.vendorDiscountShares,
      vendorShippingDiscountShares: result.vendorShippingDiscountShares,
      vendorBorneDiscountShares: result.vendorBorneDiscountShares,
      lineDiscountShares: result.lineDiscountShares,
    },
    appliedCoupons: result.perCoupon.map((entry) => ({
      code: entry.code,
      name: customerCouponName(
        result.coupons.find((coupon) => coupon.code === entry.code) ?? { code: entry.code, type: entry.type },
      ),
      discount: entry.discount,
      cashbackAmount: entry.cashbackAmount,
      type: entry.type,
      lineShares: entry.lineShares,
    })),
  };
}

async function uniqueCouponCode(prefix: string, transaction: Transaction): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCouponCode(prefix);
    const exists = await Coupon.findOne({ where: { code }, transaction, paranoid: false });
    if (!exists) return code;
  }
  throw new AppError(ERROR_MESSAGES.COUPON_CODE_TAKEN, 409, ERROR_CODES.COUPON_CODE_TAKEN);
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
      await assertVendorOwnsScopeProducts(opts.forceVendorId, {
        type: 'product',
        ids: dto.config?.bundleProductIds ?? [],
      });
    }

    const coupon = await withCodeConflictError(() => Coupon.create({
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
      // Left out: one per customer. An explicit null means no per-customer limit.
      usageLimitPerUser: dto.usageLimitPerUser === undefined ? 1 : dto.usageLimitPerUser,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      stackable: dto.stackable ?? false,
      priority: dto.priority ?? 0,
      status: defaults.status,
      showInOffers: resolveShowInOffers({
        requested: dto.showInOffers,
        restrictionType: dto.userRestriction?.type,
      }),
      discountBearer: defaults.discountBearer,
      vendorId: defaults.vendorId,
      batchId: null,
      createdById: actorId,
      updatedBy: null,
      deletedBy: null,
    }));

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

    // Orders and carts refer to a used coupon by code, and its type shaped their discounts.
    const nextCode = dto.code?.toUpperCase();
    const used = Number(coupon.usedCount ?? 0) > 0;
    if (used && ((nextCode && nextCode !== coupon.code) || (dto.type && dto.type !== coupon.type))) {
      throw new ValidationError(ERROR_MESSAGES.COUPON_USED_LOCKED);
    }

    const merged: CouponShape = {
      type: dto.type ?? coupon.type,
      value: dto.value !== undefined ? dto.value : coupon.value == null ? null : Number(coupon.value),
      startDate: dto.startDate ?? coupon.startDate.toISOString(),
      endDate: dto.endDate ?? coupon.endDate.toISOString(),
      config: dto.config !== undefined ? dto.config : coupon.config,
      userRestriction: dto.userRestriction !== undefined ? dto.userRestriction : coupon.userRestriction,
    };
    assertValidCouponShape(merged, { endMustBeFuture: dto.endDate != null });

    const patch: Record<string, unknown> = { updatedBy: actorId };
    if (nextCode) patch.code = nextCode;
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
    patch.showInOffers = resolveShowInOffers({
      requested: dto.showInOffers ?? coupon.showInOffers,
      batchId: coupon.batchId,
      restrictionType: merged.userRestriction?.type,
    });
    // An expired coupon given more time comes back paused, for its owner to resume.
    if (coupon.status === COUPON_STATUS.EXPIRED && dto.endDate != null) {
      patch.status = COUPON_STATUS.PAUSED;
    }

    if (opts.forceVendorId) {
      patch.vendorId = opts.forceVendorId;
      patch.discountBearer = DISCOUNT_BEARER.VENDOR;
      if (dto.config?.bundleProductIds) {
        await assertVendorOwnsScopeProducts(opts.forceVendorId, {
          type: 'product',
          ids: dto.config.bundleProductIds,
        });
      }
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
      if (dto.vendorId !== undefined) {
        patch.vendorId = dto.vendorId;
        patch.discountBearer = couponBearerFor(dto.vendorId);
      }
      if (dto.applicableScope != null) patch.applicableScope = dto.applicableScope;
    }

    // A vendor changing what the coupon gives away (or fixing a rejected one) asks for
    // approval again, so an approved coupon can't be turned into a different one.
    if (opts.forceVendorId) {
      const offerChanged = COUPON_FIELDS_NEEDING_REAPPROVAL.some(
        (field) =>
          field in patch &&
          JSON.stringify(patch[field] ?? null) !== JSON.stringify(coupon.get(field) ?? null) &&
          !(field === 'value' && Number(patch[field]) === Number(coupon.value)) &&
          !(field === 'maxDiscountCap' && Number(patch[field]) === Number(coupon.maxDiscountCap)),
      );
      if (coupon.status === COUPON_STATUS.REJECTED || (offerChanged && coupon.status !== COUPON_STATUS.DRAFT)) {
        patch.status = COUPON_STATUS.PENDING_APPROVAL;
      }
    }

    await withCodeConflictError(() => coupon.update(patch));
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
    else if (query.excludeBatches) where.batchId = null;
    if (query.search) where.code = { [Op.iLike]: `%${query.search.replace(/[\\%_]/g, '\\$&')}%` };
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
      include: [{ model: Vendor, attributes: ['businessName'], required: false }],
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
    /** What the customer saw come off, GST included. */
    customerSavings: number;
    /** What the coupon costs its funder: a platform coupon also pays the GST on it. */
    fundingCost: number;
    cashbackTotal: number;
    usedCountCached: number;
    usageLimitTotal: number | null;
    revenueImpact: number;
    /** Share of the total limit used; null without a limit. */
    limitUsedPercent: number | null;
  }> {
    const coupon = await this.getById(id, opts);
    const usedCount = await CouponUsage.count({ where: { couponId: coupon.id } });
    const { discountTotal: totalDiscount, customerSavings, revenueImpact } = await couponUsageMoney([coupon.id]);
    const [cashback] = await sequelize.query<{ paise: string }>(
      `SELECT COALESCE(SUM((entry->>'creditedPaise')::bigint), 0)::bigint AS paise
       FROM orders o
       CROSS JOIN LATERAL jsonb_array_elements(o."cashbackBreakdown") entry
       WHERE o."deletedAt" IS NULL
         AND jsonb_typeof(o."cashbackBreakdown") = 'array'
         AND entry->>'couponId' = :couponId`,
      { replacements: { couponId: coupon.id }, type: QueryTypes.SELECT },
    );

    const limit = coupon.usageLimitTotal == null ? null : Number(coupon.usageLimitTotal);
    const limitUsedPercent = limit != null && limit > 0 ? Math.min(100, Math.round((usedCount / limit) * 100)) : null;

    return {
      couponId: coupon.id,
      code: coupon.code,
      usedCount,
      totalDiscount: Number(totalDiscount),
      customerSavings,
      fundingCost: coupon.discountBearer === DISCOUNT_BEARER.PLATFORM ? customerSavings : Number(totalDiscount),
      cashbackTotal: fromPaise(Number(cashback?.paise ?? 0)),
      usedCountCached: Number(coupon.usedCount ?? 0),
      usageLimitTotal: limit,
      revenueImpact,
      limitUsedPercent,
    };
  }

  /** Vendor-borne discount and cashback cost absorbed this calendar month (IST). */
  async vendorAbsorbedDiscountSummary(vendorId: string): Promise<{
    vendorId: string;
    absorbedDiscountTotal: number;
    couponCount: number;
    periodStart: string;
    periodEnd: string;
  }> {
    // This calendar month in India time.
    const now = new Date();
    const periodStart = istStartOfMonth(now);
    const periodEnd = istStartOfMonth(now, 1);

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
    // Only orders that were charged and kept (as coupon analytics), and only the discount
    // on parts still standing: none on an unpaid, failed or cancelled order.
    const [absorbed] = await sequelize.query<{ discountPaise: string | null }>(
      `SELECT COALESCE(SUM(${sqlKeptCouponDiscountPaise()}), 0)::bigint AS "discountPaise"
       FROM coupon_usages cu
       INNER JOIN coupons c ON c.id = cu."couponId"
       INNER JOIN orders o ON o.id = cu."orderId" AND o."deletedAt" IS NULL
       WHERE cu."couponId" IN (:ids)
         AND cu."deletedAt" IS NULL
         AND cu."createdAt" >= :periodStart
         AND cu."createdAt" < :periodEnd
         AND ${REPORTABLE_ORDER_SQL}`,
      { replacements: { ids, periodStart, periodEnd }, type: QueryTypes.SELECT },
    );
    // Their cashback coupons cost them too: the cost rows net of reversals.
    const [cashback] = await sequelize.query<{ paise: string | null }>(
      `SELECT COALESCE(-SUM(cl."netPayoutAmountPaise"), 0)::bigint AS paise
       FROM commission_ledgers cl
       WHERE cl."vendorId" = :vendorId
         AND cl."deletedAt" IS NULL
         AND cl."referenceType" IN (:types)
         AND cl."createdAt" >= :periodStart
         AND cl."createdAt" < :periodEnd`,
      {
        replacements: {
          vendorId,
          periodStart,
          periodEnd,
          types: [COMMISSION_REFERENCE_TYPE.CASHBACK_COST, COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL],
        },
        type: QueryTypes.SELECT,
      },
    );
    return {
      vendorId,
      absorbedDiscountTotal: fromPaise(Number(absorbed?.discountPaise ?? 0) + Number(cashback?.paise ?? 0)),
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
    const from = coupon.status;
    if (!canMoveCouponStatus(from, dto.status, opts.forceVendorId ? 'vendor' : 'admin')) {
      throw new ValidationError(ERROR_MESSAGES.COUPON_STATUS_NOT_ALLOWED);
    }
    await coupon.update({
      status: dto.status,
      rejectionNote: dto.status === COUPON_STATUS.REJECTED ? (dto.note ?? null) : null,
      updatedBy: actorId,
    });
    await logAudit({
      actorId,
      action: `COUPON_${dto.status}`,
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code: coupon.code, status: dto.status, from, note: dto.note ?? null },
    });
    await notifyVendorOfDecision(coupon, from, dto, opts);
    return mapCouponResponse(coupon);
  }

  async bulkGenerate(
    dto: BulkGenerateRequest,
    actorId: string,
    opts: { forceVendorId?: string | null } = {},
  ): Promise<{ batch: CouponBatch; coupons: Coupon[] }> {
    return sequelize.transaction(async (t) => {
      const template = dto.template;
      const defaults = resolveCreateDefaults(template, opts);
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
        const code = await uniqueCouponCode(prefix, t);
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
            usageLimitPerUser: template.usageLimitPerUser === undefined ? 1 : template.usageLimitPerUser,
            startDate: new Date(template.startDate),
            endDate: new Date(template.endDate),
            stackable: template.stackable ?? false,
            priority: template.priority ?? 0,
            status: defaults.status,
            showInOffers: false,
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

  async listBatches(opts: { forceVendorId?: string | null } = {}): Promise<CouponBatchView[]> {
    return listCouponBatchViews(opts);
  }

  async applyCoupon(code: string, userId: string) {
    const { cart, lines } = await loadCartLines(userId);
    if (!cart || lines.length === 0) {
      throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
    }

    const shipping = await previewShippingTotal(userId, lines);
    const nextCode = code.trim().toUpperCase();
    // The new code on its own first: if it can't be used, what's on the cart stays.
    const alone = await validateCoupon({
      code: nextCode,
      userId,
      lines,
      shippingTotal: shipping.total,
      shippingByVendor: shipping.byVendor,
      shippingUnknown: shipping.unknown,
    });
    if (!alone.valid || !alone.coupon) throw couponRejected(alone.reason, alone.reasonCode);
    if (alone.zeroBenefit) {
      throw couponRejected(zeroBenefitMessage(alone.coupon.type), ERROR_CODES.COUPON_ZERO_BENEFIT);
    }

    const existingCodes = resolveCartCouponCodes(cart);
    const existing = existingCodes.length
      ? await Coupon.findAll({ where: { code: existingCodes } })
      : [];
    const replaced = couponsReplacedBy(alone.coupon, existing).map((row) => row.code);
    const kept = existingCodes.filter((existingCode) => !replaced.includes(existingCode));
    const nextCodes = kept.includes(alone.coupon.code) ? kept : [...kept, alone.coupon.code];

    const state = await evaluateCartCoupons({ codes: nextCodes, userId, lines, shipping });
    const result = state.result;
    if (!result.valid || !result.coupons.some((row) => row.code === alone.coupon!.code)) {
      throw couponRejected(result.reason ?? ERROR_MESSAGES.COUPON_NOT_APPLICABLE, result.reasonCode);
    }

    await saveCartCoupons(cart, state);

    const { cartService } = await import('@modules/cart/cart.service');
    const cartView = await cartService.getCart(userId, null);
    const payNowGrandTotal =
      cartView.pricingPreview?.grandTotal ?? cartView.total ?? undefined;

    const codes = result.coupons.map((c) => c.code);
    return {
      code: result.primaryCoupon?.code ?? codes[0]!,
      codes,
      replacedCodes: replaced,
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      type: result.primaryCoupon?.type ?? result.coupons[0]!.type,
      vendorDiscountShares: result.vendorDiscountShares,
      payNowGrandTotal,
    };
  }

  /**
   * Remove coupons from the cart. With no `code`, clears the entire stack. With `code`,
   * removes only that code; the others stay, whether they apply right now or not.
   */
  async removeCoupon(userId: string, code?: string | null) {
    const cart = await Cart.findOne({ where: { userId } });
    if (!cart) return { cleared: false, ...NO_COUPONS };

    const target = code?.trim().toUpperCase();
    if (!target) {
      await cart.update({ couponCode: null, couponCodes: [] });
      return { cleared: true, ...NO_COUPONS };
    }

    const nextCodes = resolveCartCouponCodes(cart).filter((c) => c !== target);
    if (nextCodes.length === 0) {
      await cart.update({ couponCode: null, couponCodes: [] });
      return { cleared: true, ...NO_COUPONS };
    }

    const { lines } = await loadCartLines(userId);
    const shipping = await previewShippingTotal(userId, lines);
    const state = await evaluateCartCoupons({ codes: nextCodes, userId, lines, shipping });
    await saveCartCoupons(cart, state);
    return { cleared: false, ...toCartCouponView(state) };
  }

  /** The cart's coupons as of now. Read-only: viewing a cart never changes what's on it. */
  async revalidateCartCoupon(userId: string) {
    const { cart, lines } = await loadCartLines(userId);
    const codes = cart ? resolveCartCouponCodes(cart) : [];
    if (!cart || codes.length === 0 || lines.length === 0) {
      return { removed: false, reason: null, reasonCode: null, ...NO_COUPONS };
    }
    const shipping = await previewShippingTotal(userId, lines);
    const state = await evaluateCartCoupons({ codes, userId, lines, shipping });
    const first = state.inactive[0];
    return {
      removed: Boolean(first),
      reason: first?.reason ?? null,
      reasonCode: first?.reasonCode ?? null,
      ...toCartCouponView(state),
    };
  }

  async eligibleCoupons(
    userId: string | null,
    opts: { limit?: number; productId?: string; variantId?: string } = {},
  ): Promise<CouponOffer[]> {
    const cartState = !opts.productId && userId ? await loadCartLines(userId) : null;
    const lines = opts.productId
      ? await loadProductPreviewLines(opts.productId, userId, opts.variantId)
      : (cartState?.lines ?? []);
    if (lines.length === 0) return [];

    const shipping = await previewShippingTotal(userId, lines, opts.productId);
    return listCouponOffers({
      userId,
      lines,
      shippingTotal: shipping.total,
      shippingByVendor: shipping.byVendor,
      shippingUnknown: shipping.unknown,
      limit: opts.limit ?? 10,
      keepZeroBenefit: Boolean(opts.productId),
      appliedCodes: cartState?.cart ? resolveCartCouponCodes(cartState.cart) : [],
    });
  }

  async notifyExpiringAndNearLimit() {
    return sendCouponAlerts();
  }

  /** Pause or resume every code in a batch that the status rules allow. */
  async setBatchStatus(
    batchId: string,
    status: 'ACTIVE' | 'PAUSED',
    actorId: string,
  ): Promise<{ updated: number }> {
    const batch = await CouponBatch.findByPk(batchId);
    if (!batch) throw new NotFoundError('Coupon batch');
    const coupons = await Coupon.findAll({ where: { batchId } });
    const movable = coupons.filter((coupon) => canMoveCouponStatus(coupon.status, status, 'admin'));
    if (movable.length > 0) {
      await Coupon.update(
        { status, updatedBy: actorId },
        { where: { id: movable.map((coupon) => coupon.id) } },
      );
    }
    await logAudit({
      actorId,
      action: `COUPON_BATCH_${status}`,
      entityType: 'CouponBatch',
      entityId: batchId,
      metadata: { updated: movable.length },
    });
    return { updated: movable.length };
  }
}

export const couponsService = new CouponsService();
