import type { Coupon, CouponConfig } from '@database/models/coupon.model';
import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';

export type CartLineForCoupon = {
  productId: string;
  categoryId: string | null;
  vendorId: string | null;
  unitPrice: number;
  quantity: number;
  /** When false, line is excluded from coupon eligibility (customerVisible gate). */
  isCustomerVisible?: boolean;
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
  const config = (coupon.config ?? {}) as CouponConfig;
  const bundleIds = (config.bundleProductIds ?? []).map(String);

  return lines.filter((line) => {
    if (line.isCustomerVisible === false) return false;
    if (isLineExcluded(line, coupon.excludedItems)) return false;

    if (coupon.vendorId && line.vendorId !== coupon.vendorId) return false;

    if (coupon.type === 'BUNDLE' && bundleIds.length > 0 && !bundleIds.includes(line.productId)) {
      return false;
    }

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

function resolveTier(coupon: Coupon): Array<{ minSubtotal: number; percent: number }> {
  const config = (coupon.config ?? {}) as CouponConfig;
  if (Array.isArray(config.tiers) && config.tiers.length > 0) {
    return config.tiers
      .map((tier) => ({
        minSubtotal: Number(tier.minSubtotal) || 0,
        percent: Number(tier.percent) || 0,
      }))
      .filter((tier) => tier.percent > 0)
      .sort((a, b) => a.minSubtotal - b.minSubtotal);
  }
  const percent = Number(coupon.value ?? 0);
  if (percent <= 0) return [];
  return [{ minSubtotal: Number(coupon.minOrderValue ?? 0), percent }];
}

export function computeTypeDiscount(
  coupon: Coupon,
  eligibleLines: CartLineForCoupon[],
  shippingTotal: number,
): { discount: number; cashbackAmount: number; freeShipping: boolean; configInvalid?: boolean } {
  const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + lineAmount(line), 0);
  const value = Number(coupon.value ?? 0);
  const cap = coupon.maxDiscountCap != null ? Number(coupon.maxDiscountCap) : Infinity;
  const config = (coupon.config ?? {}) as CouponConfig;

  switch (coupon.type) {
    case 'PERCENTAGE': {
      const raw = (eligibleSubtotal * value) / 100;
      return { discount: roundMoney(Math.min(raw, cap, eligibleSubtotal)), cashbackAmount: 0, freeShipping: false };
    }
    case 'FLAT': {
      return { discount: roundMoney(Math.min(value, eligibleSubtotal, cap)), cashbackAmount: 0, freeShipping: false };
    }
    case 'FREE_SHIPPING': {
      return {
        discount: roundMoney(Math.min(shippingTotal, cap === Infinity ? shippingTotal : cap)),
        cashbackAmount: 0,
        freeShipping: true,
      };
    }
    case 'CASHBACK': {
      const cashback = roundMoney(Math.min(value, eligibleSubtotal, cap));
      return { discount: 0, cashbackAmount: cashback, freeShipping: false };
    }
    case 'BOGO': {
      const units: number[] = [];
      for (const line of eligibleLines) {
        for (let i = 0; i < line.quantity; i++) units.push(Number(line.unitPrice));
      }
      units.sort((a, b) => a - b);
      const freeCount = Math.floor(units.length / 2);
      const discount = units.slice(0, freeCount).reduce((s, p) => s + p, 0);
      return { discount: roundMoney(Math.min(discount, cap)), cashbackAmount: 0, freeShipping: false };
    }
    case 'TIERED': {
      const tiers = resolveTier(coupon);
      if (tiers.length === 0) {
        return { discount: 0, cashbackAmount: 0, freeShipping: false, configInvalid: true };
      }
      let matchedPercent = 0;
      for (const tier of tiers) {
        if (eligibleSubtotal >= tier.minSubtotal) {
          matchedPercent = tier.percent;
        }
      }
      if (matchedPercent <= 0) {
        return { discount: 0, cashbackAmount: 0, freeShipping: false };
      }
      const raw = (eligibleSubtotal * matchedPercent) / 100;
      return {
        discount: roundMoney(Math.min(raw, cap, eligibleSubtotal)),
        cashbackAmount: 0,
        freeShipping: false,
      };
    }
    case 'BUNDLE': {
      const bundleIds = (config.bundleProductIds ?? []).map(String);
      if (bundleIds.length === 0) {
        return { discount: 0, cashbackAmount: 0, freeShipping: false, configInvalid: true };
      }
      const present = new Set(eligibleLines.map((line) => line.productId));
      const allPresent = bundleIds.every((id) => present.has(id));
      if (!allPresent) {
        return { discount: 0, cashbackAmount: 0, freeShipping: false };
      }
      return {
        discount: roundMoney(Math.min(value, eligibleSubtotal, cap)),
        cashbackAmount: 0,
        freeShipping: false,
      };
    }
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
