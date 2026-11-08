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
  type DiscountBearer,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { fromPaise, toPaise } from '@modules/pricing/money';
import {
  type CartLineForCoupon,
  capStackedCouponShares,
  computeTypeDiscount,
  filterEligibleLines,
  linesSubtotal,
  prorateDiscount,
  roundMoney,
  vendorEligibleSubtotals,
} from './coupon.utils';
import { isVendorSellable } from '@core/catalog/customerVisibility';
import { splitCouponsOntoLines, type LineDiscountShares } from './couponLineShares';
import { minOrderShortfallMessage, minQuantityShortfallMessage } from './couponErrors';

export const LOYAL_CUSTOMER_MIN_PAID_ORDERS = 3;

export type ValidateCouponInput = {
  code?: string | null;
  coupon?: Coupon | null;
  userId?: string | null;
  lines: CartLineForCoupon[];
  shippingTotal?: number;
  shippingByVendor?: Record<string, number>;
  /** No address yet, so a free-shipping coupon's worth isn't known and isn't counted as ₹0. */
  shippingUnknown?: boolean;
  /** Existing applied code on cart (for stackable checks). */
  existingCouponCode?: string | null;
  /** All codes already on the cart (multi-coupon). */
  existingCouponCodes?: string[] | null;
  /**
   * When provided, the coupon row is locked (`FOR UPDATE`) and usage-limit checks read within
   * this transaction — required at order-creation time so concurrent checkouts against a
   * usage-capped coupon serialize instead of both reading a stale `usedCount`. Omit for
   * read-only previews (cart/quote) where a lock would serve no purpose.
   */
  transaction?: Transaction;
};

export type ValidateCouponResult = {
  valid: boolean;
  reason: string | null;
  reasonCode: string | null;
  coupon: Coupon | null;
  discount: number;
  cashbackAmount: number;
  freeShipping: boolean;
  /** Valid, but gives the customer nothing as things stand (one unit on BOGO, tier not reached). */
  zeroBenefit: boolean;
  eligibleSubtotal: number;
  vendorDiscountShares: Record<string, number>;
  /** The lines this coupon applies to. */
  eligibleLines: CartLineForCoupon[];
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
  /** Waived shipping a vendor's own free-shipping coupon funds, taken from their payout. */
  vendorBorneShippingShares: Record<string, number>;
  /** Each line's part of the merchandise discount: only lines the coupons apply to. */
  lineDiscountShares: LineDiscountShares;
  primaryCoupon: Coupon | null;
  /** Per-coupon discount breakdown — each entry's own share, not the aggregate. */
  perCoupon: Array<{
    couponId: string;
    code: string;
    type: string;
    vendorId: string | null;
    discount: number;
    cashbackAmount: number;
    freeShipping: boolean;
    /** This coupon's own share by vendor (after stacking caps), as `discount` is split. */
    vendorShares: Record<string, number>;
    /** The lines it applies to (what its cashback is earned on). */
    eligibleLines: CartLineForCoupon[];
    /** Its own discount per variant, GST incl. (paise). */
    lineShares: Record<string, number>;
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
    zeroBenefit: false,
    eligibleSubtotal: 0,
    vendorDiscountShares: {},
    eligibleLines: [],
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
    vendorBorneShippingShares: {},
    lineDiscountShares: {},
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

function couponHasUsageLimit(coupon: Coupon): boolean {
  return coupon.usageLimitTotal != null || coupon.usageLimitPerUser != null;
}

/**
 * The customer's orders, for first-order and segment rules. `open`: every order not
 * cancelled, failed or refunded, unpaid online ones included, so a second checkout can't
 * claim "first order" while the first awaits payment. `paid`: orders actually paid or
 * confirmed, so a cancelled order that is awaiting its refund doesn't count.
 */
export async function countQualifyingOrders(
  userId: string,
  transaction?: Transaction,
): Promise<{ open: number; paid: number }> {
  const live = {
    userId,
    status: { [Op.ne]: ORDER_STATUS.CANCELLED },
    paymentStatus: { [Op.notIn]: [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.REFUNDED] },
  };
  const [open, paid] = await Promise.all([
    Order.count({ where: live, transaction }),
    Order.count({
      where: {
        ...live,
        [Op.or]: [
          { paymentStatus: PAYMENT_STATUS.PAID },
          { status: { [Op.in]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED] } },
        ],
      },
      transaction,
    }),
  ]);
  return { open, paid };
}

export async function validateCoupon(input: ValidateCouponInput): Promise<ValidateCouponResult> {
  const shippingTotal = input.shippingTotal ?? 0;
  let coupon = input.coupon ?? null;

  if (!coupon) {
    const code = input.code?.trim();
    if (!code) {
      return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
    }
    // Unlocked read first: most coupons carry no usage cap at all, and taking a row lock on
    // every checkout for a popular, uncapped, platform-wide coupon would serialize otherwise
    // fully-concurrent checkouts on that one row for no reason. Only the (comparatively rare)
    // usage-capped coupons below re-fetch under lock.
    coupon = await Coupon.findOne({ where: { code: code.toUpperCase() } });
  }

  if (coupon && input.transaction && couponHasUsageLimit(coupon)) {
    // Re-fetch under lock so the usage-limit checks below read a locked, current value —
    // required for both the code-lookup path above and a caller-supplied `coupon` (e.g.
    // validateCouponSet's inner loop passes a code, but this also covers any future caller that
    // passes a preloaded row).
    coupon =
      (await Coupon.findOne({
        where: { id: coupon.id },
        transaction: input.transaction,
        lock: input.transaction.LOCK.UPDATE,
      })) ?? coupon;
  }

  if (!coupon) {
    return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
  }

  const now = new Date();
  // Same answer as an unknown code: paused, rejected or future coupons don't reveal themselves.
  if (coupon.status !== COUPON_STATUS.ACTIVE || coupon.startDate > now || coupon.endDate < now) {
    return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
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
      transaction: input.transaction,
    });
    if (userUsage >= coupon.usageLimitPerUser) {
      return fail(ERROR_MESSAGES.COUPON_USAGE_LIMIT, ERROR_CODES.VALIDATION_ERROR);
    }
  }

  const eligibleLines = filterEligibleLines(coupon, input.lines);
  if (eligibleLines.length === 0) {
    return fail(ERROR_MESSAGES.COUPON_SCOPE, ERROR_CODES.COUPON_SCOPE);
  }

  const eligibleSubtotal = linesSubtotal(eligibleLines);
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
    ? fromPaise(
        Object.values(eligibleShippingByVendor).reduce((sum, amount) => sum + toPaise(amount), 0),
      )
    : shippingTotal;

  if (coupon.minOrderValue != null && eligibleSubtotal < Number(coupon.minOrderValue)) {
    return fail(minOrderShortfallMessage(Number(coupon.minOrderValue), eligibleSubtotal), ERROR_CODES.COUPON_MIN_ORDER);
  }
  if (coupon.minQuantity != null && eligibleQty < Number(coupon.minQuantity)) {
    return fail(minQuantityShortfallMessage(Number(coupon.minQuantity), eligibleQty), ERROR_CODES.COUPON_MIN_ORDER);
  }

  const restriction = coupon.userRestriction ?? { type: 'all' };
  const restrictionType = (restriction.type || 'all').toLowerCase();
  const restrictionValues = Array.isArray(restriction.value)
    ? restriction.value.map(String)
    : restriction.value
      ? [String(restriction.value)]
      : [];
  if (restrictionType === 'specific') {
    // Empty list or no user (a guest's preview): nobody qualifies. Same answer as an unknown
    // code, so a private code doesn't reveal that it exists.
    if (!input.userId || !restrictionValues.includes(input.userId)) {
      return fail(ERROR_MESSAGES.COUPON_INVALID, ERROR_CODES.COUPON_INVALID);
    }
  } else if (restrictionType === 'segment') {
    const wanted = restrictionValues.map((value) => value.toLowerCase());
    if (!input.userId || wanted.length === 0) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
    const { open, paid } = await countQualifyingOrders(input.userId, input.transaction);
    const segments = new Set<string>();
    if (open === 0) segments.add(COUPON_USER_SEGMENT.NEW);
    if (paid > 0) segments.add(COUPON_USER_SEGMENT.RETURNING);
    if (paid >= LOYAL_CUSTOMER_MIN_PAID_ORDERS) segments.add(COUPON_USER_SEGMENT.LOYAL);
    if (!wanted.some((segment) => segments.has(segment))) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  } else if (input.userId && restrictionType === 'firstorder') {
    const { open } = await countQualifyingOrders(input.userId, input.transaction);
    if (open > 0) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  }

  if (coupon.vendorId) {
    const vendor = await Vendor.findByPk(coupon.vendorId);
    // Only a vendor that can sell (APPROVED, every KYC document verified).
    if (!isVendorSellable(vendor)) {
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
    zeroBenefit: discount <= 0 && cashbackAmount <= 0 && !(freeShipping && input.shippingUnknown),
    eligibleSubtotal: roundMoney(eligibleSubtotal),
    vendorDiscountShares,
    eligibleLines,
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
  shippingUnknown?: boolean;
  /** Pass the order-creation transaction to lock each coupon row during usage-limit checks. */
  transaction?: Transaction;
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
      vendorBorneShippingShares: {},
      lineDiscountShares: {},
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
      shippingUnknown: input.shippingUnknown,
      existingCouponCodes: codes,
      transaction: input.transaction,
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
  const vendorBorneShippingShares: Record<string, number> = {};
  let discount = 0;
  let cashbackAmount = 0;
  let freeShipping = false;
  const coupons: Coupon[] = [];
  const perCoupon: ValidateCouponSetResult['perCoupon'] = [];

  // Together the coupons may come to more than a vendor's items (or shipping): cap them
  // at what is actually given — the vendor's own coupon first, a platform one after.
  const cappedShares = capStackedCouponShares(
    results.map((result) => ({
      platform: !result.coupon!.vendorId,
      freeShipping: result.freeShipping,
      shares: result.vendorDiscountShares,
    })),
    vendorEligibleSubtotals(input.lines),
    input.shippingByVendor,
  );

  results.forEach((result, index) => {
    const shares = cappedShares[index]!;
    const cutPaise = Object.entries(result.vendorDiscountShares).reduce(
      (sum, [vendorId, share]) => sum + toPaise(share) - toPaise(shares[vendorId] ?? 0),
      0,
    );
    result.vendorDiscountShares = shares;
    result.discount = fromPaise(Math.max(0, toPaise(result.discount) - cutPaise));
  });

  for (const result of results) {
    const coupon = result.coupon!;
    coupons.push(coupon);
    discount += result.discount;
    cashbackAmount += result.cashbackAmount;
    perCoupon.push({
      couponId: coupon.id,
      code: coupon.code,
      type: coupon.type,
      vendorId: coupon.vendorId ?? null,
      eligibleLines: result.eligibleLines,
      lineShares: {},
      discount: result.discount,
      cashbackAmount: result.cashbackAmount,
      freeShipping: result.freeShipping,
      vendorShares: { ...result.vendorDiscountShares },
    });
    if (result.freeShipping) freeShipping = true;
    const bearer = resolveDiscountBearer(coupon);
    for (const [vendorId, share] of Object.entries(result.vendorDiscountShares)) {
      if (result.freeShipping) {
        vendorShippingDiscountShares[vendorId] = roundMoney(
          (vendorShippingDiscountShares[vendorId] ?? 0) + share,
        );
        if (bearer === DISCOUNT_BEARER.VENDOR) {
          vendorBorneShippingShares[vendorId] = roundMoney(
            (vendorBorneShippingShares[vendorId] ?? 0) + share,
          );
        }
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
  const byCoupon: Array<Record<string, number>> = [];

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
    vendorBorneShippingShares,
    lineDiscountShares: splitCouponsOntoLines(
      results.map((result) => ({
        platform: !result.coupon!.vendorId,
        vendorBorne: resolveDiscountBearer(result.coupon) === DISCOUNT_BEARER.VENDOR,
        freeShipping: result.freeShipping,
        vendorShares: result.vendorDiscountShares,
        eligibleLines: result.eligibleLines,
      })),
      input.lines,
      byCoupon,
    ),
    primaryCoupon,
    perCoupon: perCoupon.map((entry, index) => ({ ...entry, lineShares: byCoupon[index] ?? {} })),
  };
}

export type AppliedCouponBreakdownEntry = {
  couponId: string;
  discountApplied: number;
  /** What the customer saw it take off, GST included. */
  customerDiscountApplied?: number;
};

export function breakdownFromPerCoupon(
  perCoupon: ValidateCouponSetResult['perCoupon'],
  coupons: Array<{ id: string; code: string }>,
): AppliedCouponBreakdownEntry[] {
  return perCoupon.flatMap((entry) => {
    const coupon = coupons.find((row) => row.code === entry.code);
    if (!coupon) return [];
    return [{ couponId: coupon.id, discountApplied: entry.discount }];
  });
}

export function discountAppliedFromBreakdown(
  couponId: string,
  breakdown: AppliedCouponBreakdownEntry[] | null | undefined,
  fallbackEqualShare: number,
): number {
  const entry = breakdown?.find((row) => row.couponId === couponId);
  if (entry && Number.isFinite(Number(entry.discountApplied))) {
    return Number(entry.discountApplied);
  }
  return fallbackEqualShare;
}

export {
  recordCouponUsage,
  recordCouponUsagesForOrder,
  destroyCouponUsageForOrder,
  destroyCouponUsageForVendorPart,
} from './couponUsage';

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
