import { fromPaise, roundMoney, toPaise } from '@modules/pricing/money';

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
  // Summed in paise and converted once, so many vendors cannot drift the totals.
  let merchandisePaise = 0;
  let shippingPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let discountPaise = 0;

  for (const row of vendorBreakdowns) {
    merchandisePaise += toPaise(row.subtotal);
    shippingPaise += toPaise(row.shippingCost);
    cgstPaise += toPaise(row.tax.cgst);
    sgstPaise += toPaise(row.tax.sgst);
    igstPaise += toPaise(row.tax.igst);
    discountPaise += toPaise(row.discount);
  }

  const merchandiseSubtotal = fromPaise(merchandisePaise);
  const shippingTotal = fromPaise(shippingPaise);
  const cgst = fromPaise(cgstPaise);
  const sgst = fromPaise(sgstPaise);
  const igst = fromPaise(igstPaise);
  const discountTotal = fromPaise(discountPaise);

  return {
    merchandiseSubtotal,
    shippingTotal,
    shippingDisplayKey: resolveShippingDisplayKey(shippingTotal),
    taxTotal: fromPaise(cgstPaise + sgstPaise + igstPaise),
    cgst,
    sgst,
    igst,
    discountTotal,
    taxDisplayKey: resolveTaxDisplayKey({ cgst, sgst, igst }),
    giftWrapFeeAmount: roundMoney(giftWrapFeeAmount),
  };
}
