import { coerceRupees, fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { gstOnTaxablePaise } from '@modules/pricing/pricing.engine';
import {
  checkoutAmountDue,
  combinedDiscount,
  lineTotal,
  orderItemDisplayLineSubtotal,
  priceWithGst,
  recomputeOrderDisplayFields,
  shippingCharged,
  subOrderCustomerTotal,
} from '@modules/pricing/displayMoney';
import { isReversedPart } from '@modules/pricing/partReversal';
import { REFUND_STATUS } from '@core/constants/statuses';
import { resolveShippingDisplayKey, resolveTaxDisplayKey } from '@modules/checkout/checkoutOrderTotals';

/** Primary image for an order line, resolved live from the product catalogue. */
function orderItemImageUrl(item: Record<string, unknown>): string | null {
  const product = (item.variant as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined;
  const images = (product?.images as Array<Record<string, unknown>> | undefined) ?? [];
  const primary = images.find((image) => image.isPrimary) ?? images[0];
  const url = primary?.url;
  return typeof url === 'string' && url ? url : null;
}

/**
 * An order line as the customer saw it when buying: the price per piece with GST, and
 * the line with GST before any coupon — at the rate the line was charged. A line with
 * no coupon share is exactly what was paid for it.
 */
function orderItemInclusive(item: Record<string, unknown>, unitPrice: number, quantity: number) {
  // Lines placed before per-line GST was recorded carry no breakdown: no figure, so the
  // page keeps its pre-GST one.
  if (item.taxBreakdown == null) return null;
  const tax = item.taxBreakdown as { cgst?: unknown; sgst?: unknown; gstPercentage?: unknown };
  const rate = Number(tax.gstPercentage ?? 0);
  const intraState = coerceRupees(tax.cgst) > 0 || coerceRupees(tax.sgst) > 0;
  const displayUnitPrice = priceWithGst(unitPrice, rate);
  const paidPaise = toPaise(roundMoney(item.taxableAmount)) + toPaise(roundMoney(item.taxAmount));
  if (toPaise(roundMoney(item.discountAmount)) <= 0) {
    return { displayUnitPrice, lineDisplaySubtotal: fromPaise(paidPaise), paidPaise };
  }
  const linePaise = toPaise(unitPrice) * quantity;
  const grossPaise = linePaise + gstOnTaxablePaise(linePaise, Number.isFinite(rate) ? rate : 0, intraState).total;
  return { displayUnitPrice, lineDisplaySubtotal: fromPaise(grossPaise), paidPaise };
}

export function mapOrderItem(item: Record<string, unknown>) {
  const unitPrice = roundMoney(item.unitPrice);
  const quantity = Math.trunc(coerceRupees(item.quantity)) || 0;
  const taxableAmount = roundMoney(item.taxableAmount);
  const taxAmount = roundMoney(item.taxAmount);
  const inclusive = orderItemInclusive(item, unitPrice, quantity);
  return {
    id: item.id,
    variantId: item.variantId,
    productName: item.productName,
    imageUrl: orderItemImageUrl(item),
    variantAttributes: ((item.variant as Record<string, unknown> | undefined)?.attributes as Record<string, string> | undefined) ?? null,
    productSlug: ((item.variant as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined)?.slug ?? null,
    quantity,
    unitPrice,
    discountAmount: roundMoney(item.discountAmount),
    taxableAmount,
    taxAmount,
    commissionAmount: roundMoney(item.commissionAmount),
    tcsAmount: roundMoney(item.tcsAmount),
    netPayoutAmount: roundMoney(item.netPayoutAmount),
    lineSubtotal: orderItemDisplayLineSubtotal({
      unitPrice,
      quantity,
      taxableAmount,
      taxAmount,
      storedLineSubtotal: item.lineSubtotal,
    }),
    lineTotal: lineTotal(taxableAmount, taxAmount),
    /** Price per piece as the customer saw it, GST included (null for lines without a GST breakdown). */
    displayUnitPrice: inclusive?.displayUnitPrice ?? null,
    /** The line with GST, before any coupon. */
    lineDisplaySubtotal: inclusive?.lineDisplaySubtotal ?? null,
  };
}

/**
 * A part's items as the customer saw them (GST included) and what coupons took off them;
 * null when a line has no GST breakdown to show it from.
 */
function partInclusiveItems(
  items: Array<{ lineDisplaySubtotal: number | null; taxableAmount: number; taxAmount: number }>,
) {
  let itemsPaise = 0;
  let paidPaise = 0;
  for (const item of items) {
    if (item.lineDisplaySubtotal == null) return null;
    itemsPaise += toPaise(item.lineDisplaySubtotal);
    paidPaise += toPaise(item.taxableAmount) + toPaise(item.taxAmount);
  }
  return { itemsPaise, couponSavingsPaise: Math.max(0, itemsPaise - paidPaise) };
}

export function mapSubOrder(sub: Record<string, unknown>) {
  const shippingCost = roundMoney(sub.shippingCost);
  const shippingDiscountAmount = roundMoney(sub.shippingDiscountAmount);
  const discountAmount = roundMoney(sub.discountAmount);
  const taxableAmount = roundMoney(sub.taxableAmount);
  const taxAmount = roundMoney(sub.taxAmount);
  const shippingChargedVal = shippingCharged(shippingCost, shippingDiscountAmount);
  const tb = (sub.taxBreakdown ?? {}) as { cgst?: unknown; sgst?: unknown; igst?: unknown };
  const items = ((sub.items as Record<string, unknown>[]) ?? []).map(mapOrderItem);
  const inclusive = partInclusiveItems(items);
  return {
    id: sub.id,
    orderId: sub.orderId,
    vendorId: sub.vendorId,
    vendor: sub.vendor,
    status: sub.status as string,
    subtotal: roundMoney(sub.subtotal),
    shippingCost,
    shippingDiscountAmount,
    shippingCharged: shippingChargedVal,
    shippingDisplayKey: resolveShippingDisplayKey(shippingChargedVal),
    taxAmount,
    taxableAmount,
    discountAmount,
    discountTotal: combinedDiscount(discountAmount, shippingDiscountAmount),
    /** The items as the customer saw them, GST included, before coupons. */
    itemsTotal: inclusive ? fromPaise(inclusive.itemsPaise) : null,
    /** What coupons took off those items, GST included. */
    couponSavings: inclusive ? fromPaise(inclusive.couponSavingsPaise) : null,
    taxDisplayKey: resolveTaxDisplayKey({
      cgst: roundMoney(tb.cgst),
      sgst: roundMoney(tb.sgst),
      igst: roundMoney(tb.igst),
    }),
    commissionAmount: roundMoney(sub.commissionAmount),
    tcsAmount: roundMoney(sub.tcsAmount),
    netPayoutAmount: roundMoney(sub.netPayoutAmount),
    customerTotal: subOrderCustomerTotal({
      taxableAmount,
      taxAmount,
      shippingCost,
      shippingDiscountAmount,
    }),
    taxInvoiceNumber: (sub.taxInvoiceNumber as string | null | undefined) ?? null,
    taxInvoiceIssuedAt: sub.taxInvoiceIssuedAt ?? null,
    // The card refund for a cancelled or RTO'd part, and where it stands.
    cancelRefundAmount:
      sub.cancelRefundAmountPaise != null ? fromPaise(Number(sub.cancelRefundAmountPaise)) : null,
    cancelRefundStatus: (sub.cancelRefundStatus as string | null | undefined) ?? null,
    shipment: sub.shipment ?? null,
    items,
  };
}

function sumTaxFromSubOrders(subOrders: Record<string, unknown>[]) {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const sub of subOrders) {
    const tax = (sub.taxBreakdown ?? {}) as {
      cgst?: unknown;
      sgst?: unknown;
      igst?: unknown;
    };
    cgst += roundMoney(tax.cgst);
    sgst += roundMoney(tax.sgst);
    igst += roundMoney(tax.igst);
  }
  return { cgst: roundMoney(cgst), sgst: roundMoney(sgst), igst: roundMoney(igst) };
}

export function mapOrderResponse(order: Record<string, unknown>) {
  const plain =
    typeof (order as { get?: () => unknown }).get === 'function'
      ? (order as { get: (opts: { plain: boolean }) => Record<string, unknown> }).get({ plain: true })
      : order;
  const totalAmount = roundMoney(plain.totalAmount);
  const walletAmountUsed = roundMoney(plain.walletAmountUsed);
  const originalTotalAmount = roundMoney(plain.originalTotalAmount ?? totalAmount);
  const razorpayAmountPaid = roundMoney(
    plain.razorpayAmountPaid ?? checkoutAmountDue(originalTotalAmount, walletAmountUsed),
  );
  const rawSubOrders = (plain.subOrders as Record<string, unknown>[]) ?? [];
  const subOrders = rawSubOrders.map(mapSubOrder);
  const aggregates = recomputeOrderDisplayFields({
    subOrders,
    paymentMethod: plain.paymentMethod as string | null | undefined,
    totalAmount,
    walletAmountUsed,
    razorpayAmountPaid,
    originalTotalAmount,
    razorpayPaymentId: (plain.razorpayPaymentId as string | null | undefined) ?? null,
    giftWrapFeeAmount: plain.giftWrapFeeAmount,
  });
  // Card money sent back for cancellations: each cancelled or RTO'd part's refund, and
  // a whole-order cancellation's. Issued (INITIATED) counts; a FAILED one is not back yet.
  const issued = (status: unknown) =>
    status === REFUND_STATUS.INITIATED || status === REFUND_STATUS.COMPLETED;
  const cancellationRefundPaise =
    rawSubOrders.reduce(
      (sum, sub) => sum + (issued(sub.cancelRefundStatus) ? Number(sub.cancelRefundAmountPaise ?? 0) : 0),
      0,
    ) + (issued(plain.cancelRefundStatus) ? Number(plain.cancelRefundAmountPaise ?? 0) : 0);
  // Tax lines of the parts still standing (every part when all were reversed).
  const standingRaw = rawSubOrders.filter((sub) => !isReversedPart(sub.status as string));
  const orderTax = sumTaxFromSubOrders(standingRaw.length > 0 ? standingRaw : rawSubOrders);
  // The bill as the customer sees it (GST-inclusive), over the same parts as the totals.
  const standingParts = subOrders.filter((sub) => !isReversedPart(sub.status));
  const countedParts = standingParts.length > 0 ? standingParts : subOrders;
  let itemsPaise: number | null = 0;
  let couponSavingsPaise = 0;
  for (const sub of countedParts) {
    if (sub.itemsTotal == null || sub.couponSavings == null) {
      itemsPaise = null;
      break;
    }
    itemsPaise += toPaise(sub.itemsTotal);
    couponSavingsPaise += toPaise(sub.couponSavings);
  }
  return {
    id: plain.id,
    userId: plain.userId,
    totalAmount: aggregates.totalAmount,
    discountTotal: roundMoney(plain.discountTotal),
    giftWrap: Boolean(plain.giftWrap),
    giftMessage: (plain.giftMessage as string | null | undefined) ?? null,
    giftWrapFeeAmount:
      plain.giftWrapFeeAmount != null ? roundMoney(plain.giftWrapFeeAmount) : null,
    walletAmountUsed,
    originalTotalAmount,
    razorpayAmountPaid,
    amountDue: aggregates.amountDue,
    merchandiseSubtotal: aggregates.merchandiseSubtotal,
    /**
     * The bill as the customer sees it, all GST-inclusive: itemsTotal − couponSavings +
     * shippingTotal (+ gift wrap) = totalAmount; taxTotal is the GST inside it.
     */
    itemsTotal: itemsPaise == null ? null : fromPaise(itemsPaise),
    couponSavings: itemsPaise == null ? null : fromPaise(couponSavingsPaise),
    taxTotal: aggregates.taxTotal,
    shippingTotal: aggregates.shippingTotal,
    shippingDisplayKey: resolveShippingDisplayKey(aggregates.shippingTotal),
    taxDisplayKey: resolveTaxDisplayKey(orderTax),
    status: plain.status,
    paymentStatus: plain.paymentStatus,
    pendingCashbackAmount: roundMoney(plain.pendingCashbackAmount),
    cashbackCreditedAt: plain.cashbackCreditedAt ?? null,
    cashbackDiscountBearer: plain.cashbackDiscountBearer ?? null,
    paymentMethod: plain.paymentMethod ?? null,
    cancelRefundStatus: plain.cancelRefundStatus ?? null,
    cancelRazorpayRefundId: plain.cancelRazorpayRefundId ?? null,
    cancellationRefundAmount: fromPaise(cancellationRefundPaise),
    createdAt: plain.createdAt,
    shippingAddress: plain.shippingAddress ?? null,
    customerName: (plain.user as { name?: string } | undefined)?.name ?? null,
    subOrders,
  };
}
