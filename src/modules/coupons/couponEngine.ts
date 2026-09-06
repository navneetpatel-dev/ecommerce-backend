import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import {
  COUPON_STATUS,
  COUPON_USER_SEGMENT,
  DISCOUNT_BEARER,
  ORDER_STATUS,
  PAYMENT_STATUS,
  VENDOR_STATUS,
  type DiscountBearer,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import {
  type CartLineForCoupon,
  computeTypeDiscount,
  filterEligibleLines,
  lineAmount,
  prorateDiscount,
  roundMoney,
  vendorEligibleSubtotals,
} from './coupon.utils';

export type ValidateCouponInput = {
  code?: string | null;
  coupon?: Coupon | null;
  userId?: string | null;
  lines: CartLineForCoupon[];
  shippingTotal?: number;
  shippingByVendor?: Record<string, number>;
  /** Existing applied code on cart (for stackable checks). */
  existingCouponCode?: string | null;
  /** All codes already on the cart (multi-coupon). */
  existingCouponCodes?: string[] | null;
};

export type ValidateCouponResult = {
  valid: boolean;
  reason: string | null;
  reasonCode: string | null;
  coupon: Coupon | null;
  discount: number;
  cashbackAmount: number;
  freeShipping: boolean;
  eligibleSubtotal: number;
  vendorDiscountShares: Record<string, number>;
};

export type ValidateCouponSetResult = {
  valid: boolean;
  reason: string | null;
  reasonCode: string | null;
  coupons: Coupon[];
  discount: number;
  cashbackAmount: number;
  freeShipping: boolean;
  /** Merchandise discount shares by vendor. */
  vendorDiscountShares: Record<string, number>;
  /** Shipping discount shares by vendor (FREE_SHIPPING). */
  vendorShippingDiscountShares: Record<string, number>;
  /** Vendor-borne merchandise discount shares (VENDOR bearer coupons only). */
  vendorBorneDiscountShares: Record<string, number>;
  primaryCoupon: Coupon | null;
  /** Per-coupon discount breakdown — each entry's own share, not the aggregate. */
  perCoupon: Array<{
    code: string;
    type: string;
    discount: number;
    cashbackAmount: number;
    freeShipping: boolean;
  }>;
};

function fail(reason: string, reasonCode: string): ValidateCouponResult {
  return {
    valid: false,
    reason,
    reasonCode,
    coupon: null,
    discount: 0,
    cashbackAmount: 0,
    freeShipping: false,
    eligibleSubtotal: 0,
    vendorDiscountShares: {},
  };
}

function failSet(reason: string, reasonCode: string): ValidateCouponSetResult {
  return {
    valid: false,
    reason,
    reasonCode,
    coupons: [],
    discount: 0,
    cashbackAmount: 0,
    freeShipping: false,
    vendorDiscountShares: {},
    vendorShippingDiscountShares: {},
    vendorBorneDiscountShares: {},
    primaryCoupon: null,
    perCoupon: [],
  };
}

export { prorateDiscount } from './coupon.utils';
export { type CartLineForCoupon } from './coupon.utils';

/** Normalize cart coupon fields into a unique uppercase code list. */
export function resolveCartCouponCodes(cart: {
  couponCode?: string | null;
  couponCodes?: string[] | null;
}): string[] {
  const fromArray = Array.isArray(cart.couponCodes) ? cart.couponCodes : [];
  const codes = fromArray.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  const legacy = cart.couponCode?.trim().toUpperCase();
  if (legacy && !codes.includes(legacy)) codes.unshift(legacy);
  return [...new Set(codes)];
}

export async function validateCoupon(input: ValidateCouponInput): Promise<ValidateCouponResult> {
  const shippingTotal = input.shippingTotal ?? 0;
  let coupon = input.coupon ?? null;

  if (!coupon) {
    const code = input.code?.trim();
    if (!code) {
      return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
    }
    coupon = await Coupon.findOne({ where: { code: code.toUpperCase() } });
  }

  if (!coupon) {
    return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
  }

  const now = new Date();
  if (coupon.status !== COUPON_STATUS.ACTIVE || coupon.startDate > now || coupon.endDate < now) {
    return fail(ERROR_MESSAGES.COUPON_INACTIVE, ERROR_CODES.COUPON_INACTIVE);
  }

  const existingCodes = [
    ...(input.existingCouponCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean),
  ];
  const legacy = input.existingCouponCode?.trim().toUpperCase();
  if (legacy && !existingCodes.includes(legacy)) existingCodes.push(legacy);

  const self = coupon.code.toUpperCase();
  const others = existingCodes.filter((c) => c !== self);
  if (others.length > 0) {
    if (!coupon.stackable) {
      return fail(ERROR_MESSAGES.COUPON_STACK, ERROR_CODES.COUPON_STACK);
    }
    const otherRows = await Coupon.findAll({
      where: { code: { [Op.in]: others }, status: COUPON_STATUS.ACTIVE },
    });
    if (otherRows.some((row) => !row.stackable)) {
      return fail(ERROR_MESSAGES.COUPON_STACK, ERROR_CODES.COUPON_STACK);
    }
  }

  if (coupon.usageLimitTotal != null && (coupon.usedCount ?? 0) >= coupon.usageLimitTotal) {
    return fail(ERROR_MESSAGES.COUPON_USAGE_LIMIT, ERROR_CODES.VALIDATION_ERROR);
  }

  if (coupon.usageLimitPerUser != null && input.userId) {
    const userUsage = await CouponUsage.count({
      where: { couponId: coupon.id, userId: input.userId },
    });
    if (userUsage >= coupon.usageLimitPerUser) {
      return fail(ERROR_MESSAGES.COUPON_USAGE_LIMIT, ERROR_CODES.VALIDATION_ERROR);
    }
  }

  const eligibleLines = filterEligibleLines(coupon, input.lines);
  if (eligibleLines.length === 0) {
    return fail(ERROR_MESSAGES.COUPON_SCOPE, ERROR_CODES.COUPON_SCOPE);
  }

  const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + lineAmount(line), 0);
  const eligibleQty = eligibleLines.reduce((sum, line) => sum + Number(line.quantity), 0);
  const eligibleVendorIds = new Set(
    eligibleLines.map((line) => line.vendorId ?? 'platform'),
  );
  const eligibleShippingByVendor = input.shippingByVendor
    ? Object.fromEntries(
        Object.entries(input.shippingByVendor).filter(([vendorId]) =>
          eligibleVendorIds.has(vendorId),
        ),
      )
    : undefined;
  const eligibleShippingTotal = eligibleShippingByVendor
    ? Object.values(eligibleShippingByVendor).reduce((sum, amount) => sum + amount, 0)
    : shippingTotal;

  if (coupon.minOrderValue != null && eligibleSubtotal < Number(coupon.minOrderValue)) {
    return fail(ERROR_MESSAGES.COUPON_MIN_ORDER, ERROR_CODES.COUPON_MIN_ORDER);
  }
  if (coupon.minQuantity != null && eligibleQty < Number(coupon.minQuantity)) {
    return fail(ERROR_MESSAGES.COUPON_MIN_ORDER, ERROR_CODES.COUPON_MIN_ORDER);
  }

  const restriction = coupon.userRestriction ?? { type: 'all' };
  const restrictionType = (restriction.type || 'all').toLowerCase();
  if (input.userId && restrictionType === 'firstorder') {
    const prior = await Order.count({
      where: {
        userId: input.userId,
        [Op.or]: [
          { paymentStatus: PAYMENT_STATUS.PAID },
          { status: { [Op.in]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED] } },
        ],
      },
    });
    if (prior > 0) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  } else if (input.userId && restrictionType === 'specific') {
    const allowed = Array.isArray(restriction.value)
      ? restriction.value.map(String)
      : restriction.value
        ? [String(restriction.value)]
        : [];
    if (allowed.length > 0 && !allowed.includes(input.userId)) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  } else if (input.userId && restrictionType === 'segment') {
    const wanted = Array.isArray(restriction.value)
      ? restriction.value.map((v) => String(v).toLowerCase())
      : restriction.value
        ? [String(restriction.value).toLowerCase()]
        : [];
    if (wanted.length === 0) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
    const paidOrders = await Order.count({
      where: {
        userId: input.userId,
        [Op.or]: [
          { paymentStatus: PAYMENT_STATUS.PAID },
          { status: { [Op.in]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED] } },
        ],
      },
    });
    const segments = new Set<string>();
    if (paidOrders === 0) segments.add(COUPON_USER_SEGMENT.NEW);
    if (paidOrders > 0) segments.add(COUPON_USER_SEGMENT.RETURNING);
    if (paidOrders >= 3) segments.add(COUPON_USER_SEGMENT.LOYAL);
    if (!wanted.some((segment) => segments.has(segment))) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  }

  if (coupon.vendorId) {
    const vendor = await Vendor.findByPk(coupon.vendorId);
    if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
      return fail(ERROR_MESSAGES.VENDOR_UNAVAILABLE, ERROR_CODES.VENDOR_UNAVAILABLE);
    }
  }

  const { discount, cashbackAmount, freeShipping, configInvalid } = computeTypeDiscount(
    coupon,
    eligibleLines,
    eligibleShippingTotal,
  );

  if (configInvalid) {
    return fail(ERROR_MESSAGES.COUPON_CONFIG_INVALID, ERROR_CODES.COUPON_CONFIG_INVALID);
  }

  // BUNDLE requires all configured products present — zero discount means incomplete set
  if (coupon.type === 'BUNDLE' && discount <= 0) {
    return fail(ERROR_MESSAGES.COUPON_SCOPE, ERROR_CODES.COUPON_SCOPE);
  }

  let vendorDiscountShares: Record<string, number> = {};
  if (freeShipping && eligibleShippingByVendor) {
    vendorDiscountShares = { ...eligibleShippingByVendor };
    const shippingSum = Object.values(vendorDiscountShares).reduce((s, n) => s + n, 0);
    if (shippingSum > 0 && Math.abs(shippingSum - discount) > 0.01) {
      vendorDiscountShares = prorateDiscount(discount, vendorDiscountShares);
    }
  } else if (discount > 0) {
    vendorDiscountShares = prorateDiscount(discount, vendorEligibleSubtotals(eligibleLines));
  }

  return {
    valid: true,
    reason: null,
    reasonCode: null,
    coupon,
    discount: roundMoney(discount),
    cashbackAmount: roundMoney(cashbackAmount),
    freeShipping,
    eligibleSubtotal: roundMoney(eligibleSubtotal),
    vendorDiscountShares,
  };
}

/**
 * Validate a multi-coupon set: at most one platform-wide + one vendor-scoped per seller.
 * All coupons must be stackable when more than one is present.
 */
export async function validateCouponSet(input: {
  codes: string[];
  userId: string;
  lines: CartLineForCoupon[];
  shippingTotal?: number;
  shippingByVendor?: Record<string, number>;
}): Promise<ValidateCouponSetResult> {
  const codes = [...new Set(input.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) {
    return {
      valid: true,
      reason: null,
      reasonCode: null,
      coupons: [],
      discount: 0,
      cashbackAmount: 0,
      freeShipping: false,
      vendorDiscountShares: {},
      vendorShippingDiscountShares: {},
      vendorBorneDiscountShares: {},
      primaryCoupon: null,
      perCoupon: [],
    };
  }

  const results: ValidateCouponResult[] = [];
  for (const code of codes) {
    const result = await validateCoupon({
      code,
      userId: input.userId,
      lines: input.lines,
      shippingTotal: input.shippingTotal,
      shippingByVendor: input.shippingByVendor,
      existingCouponCodes: codes,
    });
    if (!result.valid || !result.coupon) {
      return failSet(
        result.reason ?? ERROR_MESSAGES.COUPON_INVALID,
        result.reasonCode ?? ERROR_CODES.COUPON_INVALID,
      );
    }
    results.push(result);
  }

  if (codes.length > 1 && results.some((r) => !r.coupon!.stackable)) {
    return failSet(ERROR_MESSAGES.COUPON_STACK, ERROR_CODES.COUPON_STACK);
  }

  let platformCount = 0;
  const vendorSeen = new Set<string>();
  for (const result of results) {
    const coupon = result.coupon!;
    if (coupon.vendorId) {
      if (vendorSeen.has(coupon.vendorId)) {
        return failSet(ERROR_MESSAGES.COUPON_DUPLICATE_SCOPE, ERROR_CODES.COUPON_DUPLICATE_SCOPE);
      }
      vendorSeen.add(coupon.vendorId);
    } else {
      platformCount += 1;
      if (platformCount > 1) {
        return failSet(ERROR_MESSAGES.COUPON_DUPLICATE_SCOPE, ERROR_CODES.COUPON_DUPLICATE_SCOPE);
      }
    }
  }

  const vendorDiscountShares: Record<string, number> = {};
  const vendorShippingDiscountShares: Record<string, number> = {};
  const vendorBorneDiscountShares: Record<string, number> = {};
  let discount = 0;
  let cashbackAmount = 0;
  let freeShipping = false;
  const coupons: Coupon[] = [];
  const perCoupon: ValidateCouponSetResult['perCoupon'] = [];

  for (const result of results) {
    const coupon = result.coupon!;
    coupons.push(coupon);
    discount += result.discount;
    cashbackAmount += result.cashbackAmount;
    perCoupon.push({
      code: coupon.code,
      type: coupon.type,
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      freeShipping: result.freeShipping,
    });
    if (result.freeShipping) freeShipping = true;
    const bearer = resolveDiscountBearer(coupon);
    for (const [vendorId, share] of Object.entries(result.vendorDiscountShares)) {
      if (result.freeShipping) {
        vendorShippingDiscountShares[vendorId] = roundMoney(
          (vendorShippingDiscountShares[vendorId] ?? 0) + share,
        );
      } else {
        vendorDiscountShares[vendorId] = roundMoney((vendorDiscountShares[vendorId] ?? 0) + share);
        if (bearer === DISCOUNT_BEARER.VENDOR) {
          vendorBorneDiscountShares[vendorId] = roundMoney(
            (vendorBorneDiscountShares[vendorId] ?? 0) + share,
          );
        }
      }
    }
  }

  const primaryCoupon =
    coupons.find((c) => !c.vendorId) ?? coupons[0] ?? null;

  return {
    valid: true,
    reason: null,
    reasonCode: null,
    coupons,
    discount: roundMoney(discount),
    cashbackAmount: roundMoney(cashbackAmount),
    freeShipping,
    vendorDiscountShares,
    vendorShippingDiscountShares,
    vendorBorneDiscountShares,
    primaryCoupon,
    perCoupon,
  };
}

export async function recordCouponUsage(params: {
  couponId: string;
  userId: string;
  orderId: string;
  discountApplied: number;
  actorId?: string;
  transaction?: Transaction;
}): Promise<{ created: boolean }> {
  const existing = await CouponUsage.findOne({
    where: { couponId: params.couponId, orderId: params.orderId },
    transaction: params.transaction,
  });
  if (existing) {
    return { created: false };
  }

  await CouponUsage.create(
    {
      couponId: params.couponId,
      userId: params.userId,
      orderId: params.orderId,
      discountApplied: params.discountApplied,
      createdBy: params.actorId ?? params.userId,
      updatedBy: params.actorId ?? params.userId,
      deletedBy: null,
    },
    { transaction: params.transaction },
  );

  await Coupon.increment('usedCount', {
    by: 1,
    where: { id: params.couponId },
    transaction: params.transaction,
  });

  return { created: true };
}

export async function destroyCouponUsageForOrder(
  orderId: string,
  transaction?: Transaction,
): Promise<void> {
  const usages = await CouponUsage.findAll({ where: { orderId }, transaction });
  for (const usage of usages) {
    await Coupon.decrement('usedCount', {
      by: 1,
      where: { id: usage.couponId },
      transaction,
    });
    await usage.destroy({ transaction });
  }
}

export function resolveDiscountBearer(coupon: Coupon | null): DiscountBearer | null {
  if (!coupon) return null;
  return (coupon.discountBearer as DiscountBearer) ?? DISCOUNT_BEARER.PLATFORM;
}

/** Dominant bearer for a vendor slice when multiple coupons apply. */
export function resolveVendorDiscountBearer(
  vendorBorneShare: number,
  merchandiseShare: number,
): DiscountBearer {
  if (vendorBorneShare > 0 && vendorBorneShare >= merchandiseShare - 0.001) {
    return DISCOUNT_BEARER.VENDOR;
  }
  if (vendorBorneShare > 0) {
    return DISCOUNT_BEARER.VENDOR;
  }
  return DISCOUNT_BEARER.PLATFORM;
}
