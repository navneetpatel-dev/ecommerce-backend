import { coerceRupees, roundMoney } from '@modules/pricing/money';
import {
  combinedDiscount,
  lineTotal,
  orderAmountDue,
  orderItemDisplayLineSubtotal,
  recomputeOrderDisplayFields,
  shippingCharged,
  subOrderCustomerTotal,
} from '@modules/pricing/displayMoney';
import { resolveShippingDisplayKey, resolveTaxDisplayKey } from '@modules/checkout/checkoutOrderTotals';

/** Primary image for an order line, resolved live from the product catalogue. */
function orderItemImageUrl(item: Record<string, unknown>): string | null {
  const product = (item.variant as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined;
  const images = (product?.images as Array<Record<string, unknown>> | undefined) ?? [];
  const primary = images.find((image) => image.isPrimary) ?? images[0];
  const url = primary?.url;
  return typeof url === 'string' && url ? url : null;
}

export function mapOrderItem(item: Record<string, unknown>) {
  const unitPrice = roundMoney(item.unitPrice);
  const quantity = Math.trunc(coerceRupees(item.quantity)) || 0;
  const taxableAmount = roundMoney(item.taxableAmount);
  const taxAmount = roundMoney(item.taxAmount);
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
  };
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
  return {
    id: sub.id,
    orderId: sub.orderId,
    vendorId: sub.vendorId,
    vendor: sub.vendor,
    status: sub.status,
    subtotal: roundMoney(sub.subtotal),
    shippingCost,
    shippingDiscountAmount,
    shippingCharged: shippingChargedVal,
    shippingDisplayKey: resolveShippingDisplayKey(shippingChargedVal),
    taxAmount,
    taxableAmount,
    discountAmount,
    discountTotal: combinedDiscount(discountAmount, shippingDiscountAmount),
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
  const razorpayAmountPaid = roundMoney(plain.razorpayAmountPaid ?? Math.max(0, originalTotalAmount - walletAmountUsed));
  const rawSubOrders = (plain.subOrders as Record<string, unknown>[]) ?? [];
  const subOrders = rawSubOrders.map(mapSubOrder);
  const aggregates = recomputeOrderDisplayFields({
    subOrders,
    paymentMethod: plain.paymentMethod as string | null | undefined,
    totalAmount,
    walletAmountUsed,
    razorpayAmountPaid,
  });
  const orderTax = sumTaxFromSubOrders(rawSubOrders);
  return {
    id: plain.id,
    userId: plain.userId,
    totalAmount,
    discountTotal: roundMoney(plain.discountTotal),
    giftWrap: Boolean(plain.giftWrap),
    giftMessage: (plain.giftMessage as string | null | undefined) ?? null,
    giftWrapFeeAmount:
      plain.giftWrapFeeAmount != null ? roundMoney(plain.giftWrapFeeAmount) : null,
    walletAmountUsed,
    originalTotalAmount,
    razorpayAmountPaid,
    amountDue: orderAmountDue({
      paymentMethod: plain.paymentMethod as string | null | undefined,
      totalAmount,
      walletAmountUsed,
      razorpayAmountPaid,
    }),
    merchandiseSubtotal: aggregates.merchandiseSubtotal,
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
    createdAt: plain.createdAt,
    shippingAddress: plain.shippingAddress ?? null,
    customerName: (plain.user as { name?: string } | undefined)?.name ?? null,
    subOrders,
  };
}
