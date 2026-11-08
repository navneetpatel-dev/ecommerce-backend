import { allocateProportionally, toPaise } from '@modules/pricing/money';
import { lineAmount, type CartLineForCoupon } from './coupon.utils';

/** A line's part of the coupons (GST included, paise), keyed by variant. */
export type LineDiscountShares = Record<string, { discountPaise: number; vendorBornePaise: number }>;

type CouponForLines = {
  platform: boolean;
  vendorBorne: boolean;
  freeShipping: boolean;
  vendorShares: Record<string, number>;
  eligibleLines: CartLineForCoupon[];
};

const vendorKey = (line: CartLineForCoupon) => line.vendorId ?? 'platform';

/**
 * Puts each coupon's per-vendor share on the lines it actually applies to, so a coupon for
 * one product never discounts another: returns and invoices read the discount per line.
 * A vendor's own coupon goes first, as in `capStackedCouponShares`. A line never gets more
 * than its value; what doesn't fit moves to the coupon's other lines, then the vendor's.
 */
export function splitCouponsOntoLines(
  coupons: CouponForLines[],
  allLines: CartLineForCoupon[],
  /** Filled with each coupon's own share per variant (paise), in input order. */
  byCoupon: Array<Record<string, number>> = [],
): LineDiscountShares {
  const room = new Map<string, number>();
  for (const line of allLines) {
    if (line.variantId) room.set(line.variantId, toPaise(lineAmount(line)));
  }
  const shares: LineDiscountShares = {};
  let current: Record<string, number> = {};
  const give = (variantId: string, paise: number, vendorBorne: boolean) => {
    current[variantId] = (current[variantId] ?? 0) + paise;
    const entry = (shares[variantId] ??= { discountPaise: 0, vendorBornePaise: 0 });
    entry.discountPaise += paise;
    if (vendorBorne) entry.vendorBornePaise += paise;
    room.set(variantId, (room.get(variantId) ?? 0) - paise);
  };
  const place = (paise: number, lines: CartLineForCoupon[], vendorBorne: boolean): number => {
    let left = paise;
    // Clamping can free up paise, so a few passes settle it (each pass fills at least one line).
    for (let pass = 0; pass < lines.length && left > 0; pass += 1) {
      const open = lines.filter((line) => (room.get(line.variantId!) ?? 0) > 0);
      if (open.length === 0) break;
      const split = allocateProportionally(left, open.map((line) => toPaise(lineAmount(line))));
      open.forEach((line, index) => {
        const given = Math.min(split[index] ?? 0, room.get(line.variantId!) ?? 0);
        if (given > 0) give(line.variantId!, given, vendorBorne);
        left -= given;
      });
    }
    return left;
  };

  coupons.forEach((_, index) => (byCoupon[index] = {}));
  const ordered = coupons
    .map((coupon, index) => ({ coupon, index }))
    .sort((a, b) => Number(a.coupon.platform) - Number(b.coupon.platform));
  for (const { coupon, index } of ordered) {
    current = byCoupon[index]!;
    if (coupon.freeShipping) continue;
    for (const [vendorId, share] of Object.entries(coupon.vendorShares)) {
      const eligible = coupon.eligibleLines.filter((line) => line.variantId && vendorKey(line) === vendorId);
      const rest = place(toPaise(share), eligible, coupon.vendorBorne);
      if (rest > 0) {
        place(rest, allLines.filter((line) => line.variantId && vendorKey(line) === vendorId), coupon.vendorBorne);
      }
    }
  }
  return shares;
}
