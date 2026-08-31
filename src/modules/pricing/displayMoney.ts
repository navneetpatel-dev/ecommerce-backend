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

/** Customer total for one vendor sub-order. */
export function subOrderCustomerTotal(input: {
  taxableAmount?: unknown;
  taxAmount?: unknown;
  shippingCost?: unknown;
  shippingDiscountAmount?: unknown;
  customerTotal?: unknown;
}): number {
  if (input.customerTotal != null && input.customerTotal !== '') {
    return roundMoney(input.customerTotal);
  }
  return roundMoney(
    roundMoney(input.taxableAmount) +
      roundMoney(input.taxAmount) +
      shippingCharged(input.shippingCost, input.shippingDiscountAmount),
  );
}

/** Amount still payable after wallet (Razorpay remainder or COD total). */
export function orderAmountDue(input: {
  paymentMethod?: string | null;
  totalAmount?: unknown;
  walletAmountUsed?: unknown;
  razorpayAmountPaid?: unknown;
  amountDue?: unknown;
}): number {
  if (input.amountDue != null && input.amountDue !== '') {
    return roundMoney(input.amountDue);
  }
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
