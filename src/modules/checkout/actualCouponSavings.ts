import { allocateProportionally, fromPaise, toPaise, type Paise } from '@modules/pricing/money';

type CouponWithLines = { code: string; discount: number; lineShares?: Record<string, number> };

/**
 * Each coupon's real GST-inclusive saving in paise, from what the priced lines actually
 * gave (`actualLineDiscountPaise`, never less than promised). A line shared by several
 * coupons splits its real saving by their promised shares. A coupon with no line shares
 * (free shipping, cashback) keeps its own figure.
 */
export function actualCouponSavingsPaise(
  coupons: CouponWithLines[],
  actualLineDiscountPaise: Record<string, Paise>,
): Map<string, Paise> {
  const out = new Map<string, Paise>();
  const variants = new Set(coupons.flatMap((coupon) => Object.keys(coupon.lineShares ?? {})));
  for (const variantId of variants) {
    const onLine = coupons.filter((coupon) => (coupon.lineShares?.[variantId] ?? 0) > 0);
    const promised = onLine.map((coupon) => coupon.lineShares![variantId]!);
    const actual = actualLineDiscountPaise[variantId] ?? promised.reduce((sum, value) => sum + value, 0);
    allocateProportionally(actual, promised).forEach((paise, index) => {
      const code = onLine[index]!.code;
      out.set(code, (out.get(code) ?? 0) + paise);
    });
  }
  for (const coupon of coupons) {
    if (!out.has(coupon.code)) out.set(coupon.code, toPaise(coupon.discount));
  }
  return out;
}

/**
 * The coupons as the shopper sees them: each `discount` is what it really took off, so
 * a chip can never disagree with the discount row. Line shares stay on the server.
 */
export function withActualSavings<T extends CouponWithLines>(
  coupons: T[],
  actualLineDiscountPaise: Record<string, Paise>,
): Array<Omit<T, 'lineShares'>> {
  const savings = actualCouponSavingsPaise(coupons, actualLineDiscountPaise);
  return coupons.map(({ lineShares: _lineShares, ...coupon }) => ({
    ...coupon,
    discount: fromPaise(savings.get(coupon.code) ?? toPaise(coupon.discount)),
  }));
}

type SnapshotLine = { variantId: string; discountPaise: number };

/**
 * The order's offer snapshot with each line's share set to what that line really gave,
 * so a later return holds back exactly what the customer got, not the promised figure.
 * A line's real saving is split by each coupon's promised share of the line, across
 * every coupon on it (`promisedByVariant` is the total promised to the line).
 */
export function withActualLineShares<T extends { lines: SnapshotLine[] }>(
  snapshots: T[],
  promisedByVariant: Record<string, { discountPaise: number }>,
  actualLineDiscountPaise: Record<string, Paise>,
): T[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    lines: snapshot.lines.map((line) => {
      const promised = promisedByVariant[line.variantId]?.discountPaise ?? 0;
      const actual = actualLineDiscountPaise[line.variantId];
      if (promised <= 0 || actual == null) return line;
      return { ...line, discountPaise: Math.round((line.discountPaise * actual) / promised) };
    }),
  }));
}
