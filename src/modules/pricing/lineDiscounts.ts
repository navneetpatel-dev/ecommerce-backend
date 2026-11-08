import { allocateProportionally, type Paise } from './money';

type DiscountInput = {
  lines: Array<{ discountPaise?: Paise; vendorBorneDiscountPaise?: Paise }>;
  merchandiseDiscountPaise: Paise;
};

/**
 * Each line's merchandise discount. Lines that carry their own (a coupon's eligible lines)
 * keep it, so a coupon for one product stays on that product; otherwise the discount is
 * split over the lines by value.
 */
export function resolveLineDiscounts(
  input: DiscountInput,
  lines: Array<{ lineSubtotalPaise: Paise }>,
  subtotalPaise: Paise,
) {
  const targeted = input.lines.some((line) => line.discountPaise != null);
  if (targeted) {
    const lineDiscounts = lines.map((line, i) =>
      Math.min(Math.max(0, Math.round(input.lines[i]!.discountPaise ?? 0)), line.lineSubtotalPaise),
    );
    return {
      lineDiscounts,
      merchandiseDiscountPaise: lineDiscounts.reduce((sum, paise) => sum + paise, 0),
      vendorBorneOnLine: (i: number, discountPaise: Paise, _vendorBorne: Paise) =>
        Math.min(discountPaise, Math.max(0, Math.round(input.lines[i]!.vendorBorneDiscountPaise ?? 0))),
    };
  }
  const merchandiseDiscountPaise = Math.min(Math.max(0, Math.round(input.merchandiseDiscountPaise)), subtotalPaise);
  return {
    lineDiscounts: allocateProportionally(merchandiseDiscountPaise, lines.map((line) => line.lineSubtotalPaise)),
    merchandiseDiscountPaise,
    vendorBorneOnLine: (_i: number, discountPaise: Paise, vendorBorne: Paise) =>
      merchandiseDiscountPaise > 0 ? Math.round((discountPaise * vendorBorne) / merchandiseDiscountPaise) : 0,
  };
}
