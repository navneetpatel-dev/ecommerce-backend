import { toPaise, type Paise } from '@modules/pricing/money';
import { preGstDiscountPaise, type GstRatedLine } from '@modules/tax/gstPricing';
import type { LineDiscountShares } from '@modules/coupons/couponLineShares';

/**
 * One vendor's merchandise discount in pre-GST terms. Each line's share is converted at that
 * line's own GST rate, so what the customer sees comes off exactly and the discount stays on
 * the lines the coupon applies to. Without line shares, the vendor's total is used.
 */
export function resolveRowDiscounts(
  vendorId: string,
  lines: Array<{ variantId?: string }>,
  ratedLines: GstRatedLine[],
  shares: {
    vendorDiscountShares: Record<string, number>;
    vendorBorneDiscountShares: Record<string, number>;
    lineDiscountShares?: LineDiscountShares;
  },
): {
  lineDiscounts: Array<{ discountPaise: Paise; vendorBorneDiscountPaise: Paise }>;
  hasLineDiscounts: boolean;
  merchandiseDiscountPaise: Paise;
  vendorBornePaise: Paise;
} {
  const lineShares = shares.lineDiscountShares ?? {};
  const lineDiscounts = lines.map((line, index) => {
    const share = line.variantId ? lineShares[line.variantId] : undefined;
    if (!share || share.discountPaise <= 0) return { discountPaise: 0, vendorBorneDiscountPaise: 0 };
    const discountPaise = preGstDiscountPaise(share.discountPaise, [ratedLines[index]!]);
    return {
      discountPaise,
      vendorBorneDiscountPaise: Math.min(
        discountPaise,
        Math.round((discountPaise * share.vendorBornePaise) / share.discountPaise),
      ),
    };
  });
  const hasLineDiscounts = lineDiscounts.some((line) => line.discountPaise > 0);
  if (hasLineDiscounts) {
    return {
      lineDiscounts,
      hasLineDiscounts,
      merchandiseDiscountPaise: lineDiscounts.reduce((sum, line) => sum + line.discountPaise, 0),
      vendorBornePaise: lineDiscounts.reduce((sum, line) => sum + line.vendorBorneDiscountPaise, 0),
    };
  }
  const inclusive = toPaise(shares.vendorDiscountShares[vendorId] ?? 0);
  const merchandiseDiscountPaise = preGstDiscountPaise(inclusive, ratedLines);
  return {
    lineDiscounts,
    hasLineDiscounts,
    merchandiseDiscountPaise,
    // The vendor-funded part keeps its share of the discount.
    vendorBornePaise:
      inclusive > 0
        ? Math.min(
            merchandiseDiscountPaise,
            Math.round((merchandiseDiscountPaise * toPaise(shares.vendorBorneDiscountShares[vendorId] ?? 0)) / inclusive),
          )
        : 0,
  };
}
