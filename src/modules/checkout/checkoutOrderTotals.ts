export type CheckoutOrderTotals = {
  merchandiseSubtotal: number;
  shippingTotal: number;
  taxTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  discountTotal: number;
  /** FE maps to localized tax label — not a computed amount. */
  taxDisplayKey: 'IGST' | 'CGST_SGST' | 'GST';
};

type VendorBreakdownRow = {
  subtotal: number;
  shippingCost: number;
  tax: { cgst: number; sgst: number; igst: number; total: number };
  discount: number;
};

export function buildCheckoutOrderTotals(
  vendorBreakdowns: VendorBreakdownRow[],
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

  let taxDisplayKey: CheckoutOrderTotals['taxDisplayKey'] = 'GST';
  if (igst > 0 && cgst === 0 && sgst === 0) {
    taxDisplayKey = 'IGST';
  } else if (cgst > 0 || sgst > 0) {
    taxDisplayKey = 'CGST_SGST';
  }

  return {
    merchandiseSubtotal,
    shippingTotal,
    taxTotal: cgst + sgst + igst,
    cgst,
    sgst,
    igst,
    discountTotal,
    taxDisplayKey,
  };
}
