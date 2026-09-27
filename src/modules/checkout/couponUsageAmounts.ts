import { allocateProportionally, fromPaise, toPaise, type Paise } from '@modules/pricing/money';
import type { AppliedCouponBreakdownEntry, ValidateCouponSetResult } from '@modules/coupons/couponEngine';

type PricedVendor = {
  paise: { merchandiseDiscountPaise: Paise; shippingDiscountPaise: Paise };
};

/**
 * What each coupon on an order took off, as the pricing engine applied it: its part of
 * each vendor's pre-GST merchandise discount (or shipping discount, for a free-shipping
 * coupon), split in proportion to the coupons' shares of that vendor. Coupons are set in
 * GST-inclusive terms, but what a coupon costs whoever funds it is the pre-GST discount —
 * the GST on it is never collected — so usage records, budgets and coupon analytics count
 * this, in the same terms as the orders' own discount amounts.
 */
export function preGstCouponBreakdown(
  perCoupon: ValidateCouponSetResult['perCoupon'],
  coupons: Array<{ id: string; code: string }>,
  pricedByVendor: Record<string, PricedVendor>,
): AppliedCouponBreakdownEntry[] {
  const totals = new Map<string, Paise>();
  for (const [vendorId, priced] of Object.entries(pricedByVendor)) {
    for (const freeShipping of [false, true]) {
      const entries = perCoupon.filter(
        (entry) => entry.freeShipping === freeShipping && (entry.vendorShares[vendorId] ?? 0) > 0,
      );
      if (entries.length === 0) continue;
      const applied = freeShipping ? priced.paise.shippingDiscountPaise : priced.paise.merchandiseDiscountPaise;
      const split = allocateProportionally(
        applied,
        entries.map((entry) => toPaise(entry.vendorShares[vendorId] ?? 0)),
      );
      entries.forEach((entry, index) => {
        totals.set(entry.code, (totals.get(entry.code) ?? 0) + (split[index] ?? 0));
      });
    }
  }
  return perCoupon.flatMap((entry) => {
    const coupon = coupons.find((row) => row.code === entry.code);
    if (!coupon) return [];
    return [{ couponId: coupon.id, discountApplied: fromPaise(totals.get(entry.code) ?? 0) }];
  });
}
