import { coerceRupees, fromPaise, roundMoney, toPaise } from './money';
import { splitTaxAmount } from './pricing.engine';
import { codCashDuePaise, isReversedPart } from './partReversal';

/** Pre-discount extended price for a cart/order line. */
export function lineSubtotal(unitPrice: unknown, quantity: unknown): number {
  return roundMoney(roundMoney(unitPrice) * Math.trunc(Number(quantity) || 0));
}

/** Stock value of one variant at its list price — the inventory reports' valuation. */
export function inventoryValuation(unitPrice: unknown, stock: unknown): number {
  return lineSubtotal(unitPrice, stock);
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

/**
 * The order's display totals, counted over the parts still standing: a part cancelled
 * before dispatch or back undelivered (RTO) was refunded and drops out of the subtotal,
 * tax, shipping and total. When every part was reversed the order is shown as it was
 * placed. On COD, the amount due is the cash the shipments still collect.
 */
export function recomputeOrderDisplayFields(input: {
  subOrders: Array<{
    status?: string | null;
    subtotal: unknown;
    taxAmount: unknown;
    shippingCost: unknown;
    shippingDiscountAmount: unknown;
    customerTotal?: unknown;
  }>;
  paymentMethod?: string | null;
  totalAmount: unknown;
  walletAmountUsed: unknown;
  razorpayAmountPaid: unknown;
  originalTotalAmount?: unknown;
  razorpayPaymentId?: string | null;
  giftWrapFeeAmount?: unknown;
}) {
  const standing = input.subOrders.filter((sub) => !isReversedPart(sub.status));
  const counted = standing.length > 0 ? standing : input.subOrders;
  const partTotalPaise = (sub: (typeof input.subOrders)[number]) =>
    toPaise(
      sub.customerTotal != null
        ? roundMoney(sub.customerTotal)
        : subOrderCustomerTotal({
            taxableAmount: sub.subtotal,
            taxAmount: sub.taxAmount,
            shippingCost: sub.shippingCost,
            shippingDiscountAmount: sub.shippingDiscountAmount,
          }),
    );
  let merchandiseSubtotal = 0;
  let taxTotal = 0;
  let shippingTotal = 0;
  for (const sub of counted) {
    merchandiseSubtotal += roundMoney(sub.subtotal);
    taxTotal += roundMoney(sub.taxAmount);
    shippingTotal += shippingCharged(sub.shippingCost, sub.shippingDiscountAmount);
  }
  // The order total only changes on returns (delivered parts), so taking the reversed
  // parts out of it leaves the standing parts, their returns and the gift-wrap fee.
  const reversedPaise =
    standing.length > 0
      ? input.subOrders
          .filter((sub) => isReversedPart(sub.status))
          .reduce((sum, sub) => sum + partTotalPaise(sub), 0)
      : 0;
  const totalAmount = fromPaise(Math.max(0, toPaise(roundMoney(input.totalAmount)) - reversedPaise));
  const amountDue =
    input.paymentMethod === 'COD' && input.subOrders.length > 0
      ? fromPaise(
          codCashDuePaise(
            input,
            input.subOrders.map((sub) => ({ status: sub.status, totalPaise: partTotalPaise(sub) })),
          ),
        )
      : orderAmountDue({
          paymentMethod: input.paymentMethod,
          totalAmount: input.totalAmount,
          walletAmountUsed: input.walletAmountUsed,
          razorpayAmountPaid: input.razorpayAmountPaid,
        });
  return {
    merchandiseSubtotal: roundMoney(merchandiseSubtotal),
    taxTotal: roundMoney(taxTotal),
    shippingTotal: roundMoney(shippingTotal),
    totalAmount,
    amountDue,
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
  // The stored split no longer matches the tax (the line was partly returned): split
  // the tax afresh in paise so CGST + SGST (or IGST) adds up to it exactly.
  const split = splitTaxAmount(toPaise(tax), igst <= 0);
  return { cgst: fromPaise(split.cgst), sgst: fromPaise(split.sgst), igst: fromPaise(split.igst) };
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

/** Payable remainder at quote/checkout before payment is captured. */
export function checkoutAmountDue(
  totalAmount: unknown,
  walletAmountUsed: unknown,
): number {
  return roundMoney(Math.max(0, roundMoney(totalAmount) - roundMoney(walletAmountUsed)));
}

export function productShowMrp(basePrice: unknown, compareAtPrice: unknown): boolean {
  const price = roundMoney(basePrice);
  const compare =
    compareAtPrice != null && compareAtPrice !== '' ? roundMoney(compareAtPrice) : null;
  return compare != null && compare > price;
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

/** A declared cash deposit further than this from the expected COD cash is flagged for review. */
export const CASH_DEPOSIT_TOLERANCE_PAISE = 1;

/**
 * Declared-minus-expected gap on an agent's end-of-shift cash deposit (negative =
 * short), in rupees, and whether it exceeds the review tolerance. Computed in paise.
 */
export function cashDepositDiscrepancy(
  amount: unknown,
  expectedAmount: unknown,
): { discrepancyAmount: number; hasDiscrepancy: boolean } {
  const gapPaise = toPaise(coerceRupees(amount)) - toPaise(coerceRupees(expectedAmount));
  return {
    discrepancyAmount: fromPaise(gapPaise),
    hasDiscrepancy: Math.abs(gapPaise) > CASH_DEPOSIT_TOLERANCE_PAISE,
  };
}

/**
 * How much a wishlisted product's list price has fallen since it was saved, or
 * null when it has not fallen. Drives the wishlist "Price dropped" badge.
 */
export function wishlistPriceDrop(priceAtAdd: unknown, currentPrice: unknown): number | null {
  const dropPaise = toPaise(coerceRupees(priceAtAdd)) - toPaise(coerceRupees(currentPrice));
  return dropPaise > 0 ? fromPaise(dropPaise) : null;
}
