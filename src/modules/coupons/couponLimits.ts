import { ValidationError } from '@core/errors/ValidationError';

/**
 * Ceilings for platform coupons created by anyone who does not hold `coupon.unlimited`
 * (the Catalog Manager). SUPER_ADMIN, and any role granted that permission, are not limited.
 * Amounts are rupees, like `Coupon.value` and `Coupon.maxDiscountCap`.
 */
export const COUPON_LIMITS = {
  /** Largest percentage off a PERCENTAGE coupon, or any TIERED tier. */
  maxPercent: 30,
  /** Largest fixed amount for FLAT, BUNDLE and CASHBACK coupons. */
  maxFixedRupees: 1000,
  /** Largest `maxDiscountCap`; percentage-style coupons must carry one. */
  maxDiscountCapRupees: 2000,
} as const;

export type CouponLimitsInput = {
  type: string;
  value?: number | string | null;
  maxDiscountCap?: number | string | null;
  config?: { tiers?: Array<{ percent: number }> } | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const NEEDS_SUPER_ADMIN = 'needs a Super Admin (coupon.unlimited)';

/** Throws a 422 when the coupon is more generous than the standard ceilings allow. */
export function assertCouponWithinLimits(coupon: CouponLimitsInput): void {
  const { maxPercent, maxFixedRupees, maxDiscountCapRupees } = COUPON_LIMITS;
  const value = num(coupon.value);
  const cap = num(coupon.maxDiscountCap);

  if (cap !== null && cap > maxDiscountCapRupees) {
    throw new ValidationError(`A maximum discount above ₹${maxDiscountCapRupees} ${NEEDS_SUPER_ADMIN}`);
  }

  if (coupon.type === 'PERCENTAGE' || coupon.type === 'TIERED') {
    if (coupon.type === 'PERCENTAGE' && value !== null && value > maxPercent) {
      throw new ValidationError(`A percentage discount above ${maxPercent}% ${NEEDS_SUPER_ADMIN}`);
    }
    if (coupon.type === 'TIERED') {
      if (value !== null && value > maxPercent) {
        throw new ValidationError(`A percentage discount above ${maxPercent}% ${NEEDS_SUPER_ADMIN}`);
      }
      for (const tier of coupon.config?.tiers ?? []) {
        if (Number(tier.percent) > maxPercent) {
          throw new ValidationError(`A tier above ${maxPercent}% ${NEEDS_SUPER_ADMIN}`);
        }
      }
    }
    if (cap === null) {
      throw new ValidationError(`Percentage coupons need a maximum discount of at most ₹${maxDiscountCapRupees}`);
    }
    return;
  }

  if ((coupon.type === 'FLAT' || coupon.type === 'BUNDLE' || coupon.type === 'CASHBACK') && value !== null && value > maxFixedRupees) {
    throw new ValidationError(`A fixed discount above ₹${maxFixedRupees} ${NEEDS_SUPER_ADMIN}`);
  }
}

/**
 * Checks an edit against the ceilings. Only edits that touch the discount itself (type, value,
 * maximum discount, tiers) are checked, so an unrelated edit (a new end date) to a generous
 * coupon a Super Admin made is not blocked for the manager.
 */
export function assertEditedCouponWithinLimits(
  coupon: { type: string; value: number | string | null; maxDiscountCap: number | string | null; config: unknown },
  dto: { type?: string | null; value?: number | null; maxDiscountCap?: number | null; config?: unknown },
): void {
  const touchesDiscount =
    dto.type != null || dto.value !== undefined || dto.maxDiscountCap !== undefined || dto.config !== undefined;
  if (!touchesDiscount) return;
  assertCouponWithinLimits({
    type: dto.type ?? coupon.type,
    value: dto.value !== undefined ? dto.value : coupon.value,
    maxDiscountCap: dto.maxDiscountCap !== undefined ? dto.maxDiscountCap : coupon.maxDiscountCap,
    config: (dto.config ?? coupon.config) as CouponLimitsInput['config'],
  });
}
