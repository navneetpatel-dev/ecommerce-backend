import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  COUPON_STATUS,
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
  userId: string;
  lines: CartLineForCoupon[];
  shippingTotal?: number;
  shippingByVendor?: Record<string, number>;
  /** Existing applied code on cart (for stackable checks). */
  existingCouponCode?: string | null;
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

export { prorateDiscount, commissionSaleAmount } from './coupon.utils';
export { type CartLineForCoupon } from './coupon.utils';

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

  // Stackable: reject if cart already has a different non-stackable coupon
  const existing = input.existingCouponCode?.trim().toUpperCase();
  if (existing && existing !== coupon.code.toUpperCase()) {
    if (!coupon.stackable) {
      return fail(ERROR_MESSAGES.COUPON_STACK, ERROR_CODES.COUPON_STACK);
    }
    const other = await Coupon.findOne({ where: { code: existing, status: COUPON_STATUS.ACTIVE } });
    if (other && !other.stackable) {
      return fail(ERROR_MESSAGES.COUPON_STACK, ERROR_CODES.COUPON_STACK);
    }
  }

  if (coupon.usageLimitTotal != null && (coupon.usedCount ?? 0) >= coupon.usageLimitTotal) {
    return fail(ERROR_MESSAGES.COUPON_USAGE_LIMIT, ERROR_CODES.VALIDATION_ERROR);
  }

  if (coupon.usageLimitPerUser != null) {
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

  if (coupon.minOrderValue != null && eligibleSubtotal < Number(coupon.minOrderValue)) {
    return fail(ERROR_MESSAGES.COUPON_MIN_ORDER, ERROR_CODES.COUPON_MIN_ORDER);
  }
  if (coupon.minQuantity != null && eligibleQty < Number(coupon.minQuantity)) {
    return fail(ERROR_MESSAGES.COUPON_MIN_ORDER, ERROR_CODES.COUPON_MIN_ORDER);
  }

  const restriction = coupon.userRestriction ?? { type: 'all' };
  const restrictionType = (restriction.type || 'all').toLowerCase();
  if (restrictionType === 'firstorder') {
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
  } else if (restrictionType === 'specific') {
    const allowed = Array.isArray(restriction.value)
      ? restriction.value.map(String)
      : restriction.value
        ? [String(restriction.value)]
        : [];
    if (allowed.length > 0 && !allowed.includes(input.userId)) {
      return fail(ERROR_MESSAGES.COUPON_RESTRICTION, ERROR_CODES.COUPON_RESTRICTION);
    }
  }

  if (coupon.vendorId) {
    const vendor = await Vendor.findByPk(coupon.vendorId);
    if (!vendor || vendor.status !== VENDOR_STATUS.APPROVED) {
      return fail(ERROR_MESSAGES.VENDOR_UNAVAILABLE, ERROR_CODES.VENDOR_UNAVAILABLE);
    }
  }

  const { discount, cashbackAmount, freeShipping } = computeTypeDiscount(
    coupon,
    eligibleLines,
    shippingTotal,
  );

  let vendorDiscountShares: Record<string, number> = {};
  if (freeShipping && input.shippingByVendor) {
    vendorDiscountShares = { ...input.shippingByVendor };
    // Cap each vendor share so sum equals discount (already shippingTotal)
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

export async function creditCashbackIfNeeded(params: {
  coupon: Coupon;
  userId: string;
  orderId: string;
  cashbackAmount: number;
  transaction?: Transaction;
}): Promise<void> {
  if (params.coupon.type !== 'CASHBACK' || params.cashbackAmount <= 0) return;

  const existing = await WalletLedger.findOne({
    where: {
      userId: params.userId,
      referenceType: 'COUPON_CASHBACK',
      referenceId: params.orderId,
    },
    transaction: params.transaction,
  });
  if (existing) return;

  const last = await WalletLedger.findOne({
    where: { userId: params.userId },
    order: [['createdAt', 'DESC']],
    transaction: params.transaction,
  });
  const balanceAfter = roundMoney(Number(last?.balanceAfter ?? 0) + params.cashbackAmount);

  await WalletLedger.create(
    {
      userId: params.userId,
      type: 'CREDIT',
      amount: params.cashbackAmount,
      balanceAfter,
      referenceType: 'COUPON_CASHBACK',
      referenceId: params.orderId,
      description: `Cashback from coupon ${params.coupon.code}`,
      expiresAt: null,
      createdBy: params.userId,
      updatedBy: null,
      deletedBy: null,
    },
    { transaction: params.transaction },
  );
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
