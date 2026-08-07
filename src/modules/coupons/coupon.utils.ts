import type { Coupon } from '@database/models/coupon.model';
import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';

export type CartLineForCoupon = {
  productId: string;
  categoryId: string | null;
  vendorId: string | null;
  unitPrice: number;
  quantity: number;
};

export function roundMoney(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100);
}

/** Distribute totalDiscount across vendors proportional to subtotals; remainder on largest share. */
export function prorateDiscount(
  totalDiscount: number,
  vendorSubtotals: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(vendorSubtotals).filter(([, v]) => v > 0);
  const result: Record<string, number> = {};
  for (const id of Object.keys(vendorSubtotals)) {
    result[id] = 0;
  }
  if (entries.length === 0 || totalDiscount <= 0) {
    return result;
  }

  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total <= 0) return result;

  let allocated = 0;
  let largestId = entries[0]![0];
  let largestSubtotal = entries[0]![1];

  for (const [vendorId, subtotal] of entries) {
    if (subtotal > largestSubtotal) {
      largestSubtotal = subtotal;
      largestId = vendorId;
    }
    const share = roundMoney((totalDiscount * subtotal) / total);
    result[vendorId] = share;
    allocated += share;
  }

  const remainder = roundMoney(totalDiscount - allocated);
  if (remainder !== 0) {
    result[largestId] = roundMoney((result[largestId] ?? 0) + remainder);
  }

  return result;
}

export function commissionSaleAmount(
  subtotal: number,
  vendorDiscountShare: number,
  discountBearer: DiscountBearer | null | undefined,
): number {
  if (discountBearer === DISCOUNT_BEARER.VENDOR) {
    return roundMoney(Math.max(0, subtotal - vendorDiscountShare));
  }
  return roundMoney(subtotal);
}

export function lineAmount(line: CartLineForCoupon): number {
  return Number(line.unitPrice) * Number(line.quantity);
}

export function isLineExcluded(
  line: CartLineForCoupon,
  excluded: { productIds?: string[]; categoryIds?: string[] } | null | undefined,
): boolean {
  if (!excluded) return false;
  if (excluded.productIds?.includes(line.productId)) return true;
  if (line.categoryId && excluded.categoryIds?.includes(line.categoryId)) return true;
  return false;
}

export function filterEligibleLines(coupon: Coupon, lines: CartLineForCoupon[]): CartLineForCoupon[] {
  const scope = coupon.applicableScope ?? { type: 'all', ids: [] };
  const scopeType = (scope.type || 'all').toLowerCase();
  const ids = (scope.ids ?? []).map(String);

  return lines.filter((line) => {
    if (isLineExcluded(line, coupon.excludedItems)) return false;

    if (coupon.vendorId && line.vendorId !== coupon.vendorId) return false;

    switch (scopeType) {
      case 'all':
        return true;
      case 'vendor':
        return !!line.vendorId && (ids.length === 0 ? line.vendorId === coupon.vendorId : ids.includes(line.vendorId));
      case 'product':
        return ids.includes(line.productId);
      case 'category':
        return !!line.categoryId && ids.includes(line.categoryId);
      default:
        return true;
    }
  });
}

export function computeTypeDiscount(
  coupon: Coupon,
  eligibleLines: CartLineForCoupon[],
  shippingTotal: number,
): { discount: number; cashbackAmount: number; freeShipping: boolean } {
  const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + lineAmount(line), 0);
  const value = Number(coupon.value ?? 0);
  const cap = coupon.maxDiscountCap != null ? Number(coupon.maxDiscountCap) : Infinity;

  switch (coupon.type) {
    case 'PERCENTAGE': {
      const raw = (eligibleSubtotal * value) / 100;
      return { discount: roundMoney(Math.min(raw, cap, eligibleSubtotal)), cashbackAmount: 0, freeShipping: false };
    }
    case 'FLAT': {
      return { discount: roundMoney(Math.min(value, eligibleSubtotal, cap)), cashbackAmount: 0, freeShipping: false };
    }
    case 'FREE_SHIPPING': {
      return { discount: roundMoney(Math.min(shippingTotal, cap === Infinity ? shippingTotal : cap)), cashbackAmount: 0, freeShipping: true };
    }
    case 'CASHBACK': {
      const cashback = roundMoney(Math.min(value, eligibleSubtotal, cap));
      return { discount: 0, cashbackAmount: cashback, freeShipping: false };
    }
    case 'BOGO': {
      // Simple: buy 2 get 1 — discount cheapest unit among eligible lines (by unit price).
      const units: number[] = [];
      for (const line of eligibleLines) {
        for (let i = 0; i < line.quantity; i++) units.push(Number(line.unitPrice));
      }
      units.sort((a, b) => a - b);
      const freeCount = Math.floor(units.length / 2);
      const discount = units.slice(0, freeCount).reduce((s, p) => s + p, 0);
      return { discount: roundMoney(Math.min(discount, cap)), cashbackAmount: 0, freeShipping: false };
    }
    case 'TIERED':
    case 'BUNDLE':
      // Config-driven types: valid pass with 0 discount until template configs are expanded.
      return { discount: 0, cashbackAmount: 0, freeShipping: false };
    default:
      return { discount: 0, cashbackAmount: 0, freeShipping: false };
  }
}

export function vendorEligibleSubtotals(
  eligibleLines: CartLineForCoupon[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const line of eligibleLines) {
    const key = line.vendorId || 'platform';
    map[key] = (map[key] ?? 0) + lineAmount(line);
  }
  return map;
}

export function generateCouponCode(prefix = 'CPN'): string {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}${rand}`.slice(0, 16);
}
