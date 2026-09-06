import { roundMoney } from '@modules/pricing/money';

export type ShippingDisplayKey = 'FREE' | 'PAID';

export type CheckoutOrderTotals = {
  merchandiseSubtotal: number;
  shippingTotal: number;
  shippingDisplayKey: ShippingDisplayKey;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  discountTotal: number;
  /** FE maps to localized tax label — not a computed amount. */
  taxDisplayKey: 'IGST' | 'CGST_SGST' | 'GST';
  /** Flat checkout-time gift-wrap fee (0 when not selected) — not per vendor. */
  giftWrapFeeAmount: number;
};

type VendorBreakdownRow = {
  subtotal: number;
  shippingCost: number;
  tax: { cgst: number; sgst: number; igst: number; total: number };
  discount: number;
};

export function resolveVendorIdForShippingRates(vendorId: string): string | null {
  return vendorId !== 'platform' ? vendorId : null;
}

export function resolveShippingDisplayKey(shippingCost: number): ShippingDisplayKey {
  return shippingCost === 0 ? 'FREE' : 'PAID';
}

export function resolveTaxDisplayKey(tax: {
  cgst: number;
  sgst: number;
  igst: number;
}): CheckoutOrderTotals['taxDisplayKey'] {
  if (tax.igst > 0 && (tax.cgst > 0 || tax.sgst > 0)) {
    return 'GST';
  }
  if (tax.igst > 0) {
    return 'IGST';
  }
  if (tax.cgst > 0 || tax.sgst > 0) {
    return 'CGST_SGST';
  }
  return 'GST';
}

export function buildCheckoutOrderTotals(
  vendorBreakdowns: VendorBreakdownRow[],
  giftWrapFeeAmount = 0,
): CheckoutOrderTotals {
  let merchandiseSubtotal = 0;
  let shippingTotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let discountTotal = 0;

  for (const row of vendorBreakdowns) {
    merchandiseSubtotal += row.subtotal;
    shippingTotal += row.shippingCost;
    cgst += row.tax.cgst;
    sgst += row.tax.sgst;
    igst += row.tax.igst;
    discountTotal += row.discount;
  }

  // Round each aggregate once at the end — summing raw floats across many vendors drifts.
  merchandiseSubtotal = roundMoney(merchandiseSubtotal);
  shippingTotal = roundMoney(shippingTotal);
  cgst = roundMoney(cgst);
  sgst = roundMoney(sgst);
  igst = roundMoney(igst);
  discountTotal = roundMoney(discountTotal);

  return {
    merchandiseSubtotal,
    shippingTotal,
    shippingDisplayKey: resolveShippingDisplayKey(shippingTotal),
    taxTotal: roundMoney(cgst + sgst + igst),
    cgst,
    sgst,
    igst,
    discountTotal,
    taxDisplayKey: resolveTaxDisplayKey({ cgst, sgst, igst }),
    giftWrapFeeAmount: roundMoney(giftWrapFeeAmount),
  };
}
