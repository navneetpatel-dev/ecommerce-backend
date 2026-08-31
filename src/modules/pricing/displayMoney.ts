import { roundMoney } from './money';

/** Pre-discount extended price for a cart/order line. */
export function lineSubtotal(unitPrice: unknown, quantity: unknown): number {
  return roundMoney(roundMoney(unitPrice) * Math.trunc(Number(quantity) || 0));
}

/** Customer line total after discount, including tax (excludes shipping). */
export function lineTotal(taxableAmount: unknown, taxAmount: unknown): number {
  return roundMoney(roundMoney(taxableAmount) + roundMoney(taxAmount));
}

/** Net shipping charged to the customer after shipping coupon discount. */
export function shippingCharged(
  shippingCost: unknown,
  shippingDiscountAmount: unknown,
): number {
  return roundMoney(roundMoney(shippingCost) - roundMoney(shippingDiscountAmount));
}

/** Combined merchandise + shipping discount shown on receipts. */
export function combinedDiscount(
  merchandiseDiscount: unknown,
  shippingDiscountAmount: unknown,
): number {
  return roundMoney(roundMoney(merchandiseDiscount) + roundMoney(shippingDiscountAmount));
}

/** Customer total for one vendor sub-order — always derived from live components. */
export function subOrderCustomerTotal(input: {
  taxableAmount?: unknown;
  taxAmount?: unknown;
  shippingCost?: unknown;
  shippingDiscountAmount?: unknown;
}): number {
  return roundMoney(
    roundMoney(input.taxableAmount) +
      roundMoney(input.taxAmount) +
      shippingCharged(input.shippingCost, input.shippingDiscountAmount),
  );
}

/** Amount payable after wallet — always derived from current order totals. */
export function orderAmountDue(input: {
  paymentMethod?: string | null;
  totalAmount?: unknown;
  walletAmountUsed?: unknown;
  razorpayAmountPaid?: unknown;
}): number {
  const walletUsed = roundMoney(input.walletAmountUsed);
  const total = roundMoney(input.totalAmount);
  const razorpayPaid = roundMoney(input.razorpayAmountPaid);
  if (input.paymentMethod === 'COD') {
    return roundMoney(Math.max(0, total - walletUsed));
  }
  if (razorpayPaid > 0 || walletUsed > 0) {
    return razorpayPaid;
  }
  return total;
}

export function recomputeSubOrderDisplayFields(input: {
  taxableAmount: unknown;
  taxAmount: unknown;
  shippingCost: unknown;
  shippingDiscountAmount: unknown;
}) {
  const shippingChargedVal = shippingCharged(input.shippingCost, input.shippingDiscountAmount);
  return {
    shippingCharged: shippingChargedVal,
    customerTotal: subOrderCustomerTotal(input),
  };
}

export function recomputeOrderDisplayFields(input: {
  subOrders: Array<{
    subtotal: unknown;
    taxAmount: unknown;
    shippingCost: unknown;
    shippingDiscountAmount: unknown;
  }>;
  paymentMethod?: string | null;
  totalAmount: unknown;
  walletAmountUsed: unknown;
  razorpayAmountPaid: unknown;
}) {
  let merchandiseSubtotal = 0;
  let taxTotal = 0;
  let shippingTotal = 0;
  for (const sub of input.subOrders) {
    merchandiseSubtotal += roundMoney(sub.subtotal);
    taxTotal += roundMoney(sub.taxAmount);
    shippingTotal += shippingCharged(sub.shippingCost, sub.shippingDiscountAmount);
  }
  return {
    merchandiseSubtotal: roundMoney(merchandiseSubtotal),
    taxTotal: roundMoney(taxTotal),
    shippingTotal: roundMoney(shippingTotal),
    amountDue: orderAmountDue({
      paymentMethod: input.paymentMethod,
      totalAmount: input.totalAmount,
      walletAmountUsed: input.walletAmountUsed,
      razorpayAmountPaid: input.razorpayAmountPaid,
    }),
  };
}

/** GST split for tax invoice lines — ignores stale breakdown when line is returned. */
export function invoiceLineTaxBreakdown(input: {
  taxableAmount: unknown;
  taxAmount?: unknown;
  taxBreakdown?: Record<string, unknown> | null;
}): { cgst: number; sgst: number; igst: number } {
  const taxable = roundMoney(input.taxableAmount);
  if (taxable <= 0) {
    return { cgst: 0, sgst: 0, igst: 0 };
  }
  const tb = input.taxBreakdown ?? {};
  const cgst = roundMoney(tb.cgst);
  const sgst = roundMoney(tb.sgst);
  const igst = roundMoney(tb.igst);
  const breakdownTotal = roundMoney(cgst + sgst + igst);
  const tax = roundMoney(input.taxAmount) || breakdownTotal;
  if (tax <= 0) {
    return { cgst: 0, sgst: 0, igst: 0 };
  }
  if (breakdownTotal <= 0) {
    return { cgst: 0, sgst: 0, igst: tax };
  }
  if (Math.abs(breakdownTotal - tax) < 0.01) {
    return { cgst, sgst, igst };
  }
  const scale = tax / breakdownTotal;
  return {
    cgst: roundMoney(cgst * scale),
    sgst: roundMoney(sgst * scale),
    igst: roundMoney(igst * scale),
  };
}

/** Customer-facing pre-discount extended price for an order line. */
export function orderItemDisplayLineSubtotal(input: {
  unitPrice: unknown;
  quantity: unknown;
  taxableAmount: unknown;
  taxAmount: unknown;
  storedLineSubtotal?: unknown;
}): number {
  const taxable = roundMoney(input.taxableAmount);
  const tax = roundMoney(input.taxAmount);
  const quantity = Math.trunc(Number(input.quantity) || 0);
  if (quantity > 0 && taxable === 0 && tax === 0) {
    return 0;
  }
  if (input.storedLineSubtotal != null && input.storedLineSubtotal !== '') {
    return roundMoney(input.storedLineSubtotal);
  }
  return lineSubtotal(input.unitPrice, quantity);
}

/** Scale persisted GST breakdown after a partial return. */
export function scaleTaxBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
  ratio: number,
): Record<string, unknown> | null {
  if (!breakdown) return null;
  const scale = Math.max(0, Math.min(1, ratio));
  if (scale <= 0) {
    return {
      cgst: 0,
      sgst: 0,
      igst: 0,
      gstPercentage: breakdown.gstPercentage ?? 0,
    };
  }
  return {
    ...breakdown,
    cgst: roundMoney(roundMoney(breakdown.cgst) * scale),
    sgst: roundMoney(roundMoney(breakdown.sgst) * scale),
    igst: roundMoney(roundMoney(breakdown.igst) * scale),
  };
}

export function productDiscountPercent(
  basePrice: unknown,
  compareAtPrice: unknown,
): number | null {
  const price = roundMoney(basePrice);
  const compare = compareAtPrice != null && compareAtPrice !== ''
    ? roundMoney(compareAtPrice)
    : null;
  if (compare == null || compare <= price || compare <= 0) return null;
  return Math.round((1 - price / compare) * 100);
}

export function taxInclusivePrice(
  basePrice: unknown,
  gstPercentage: unknown,
  taxInclusive?: boolean | null,
): number | null {
  if (!taxInclusive) return null;
  const pct = Number(gstPercentage ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return roundMoney(roundMoney(basePrice) * (1 + pct / 100));
}
