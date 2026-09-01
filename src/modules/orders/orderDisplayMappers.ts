import { coerceRupees, roundMoney } from '@modules/pricing/money';
import {
  combinedDiscount,
  lineSubtotal,
  lineTotal,
  orderAmountDue,
  orderItemDisplayLineSubtotal,
  recomputeOrderDisplayFields,
  shippingCharged,
  subOrderCustomerTotal,
} from '@modules/pricing/displayMoney';

export function mapOrderItem(item: Record<string, unknown>) {
  const unitPrice = roundMoney(item.unitPrice);
  const quantity = Math.trunc(coerceRupees(item.quantity)) || 0;
  const taxableAmount = roundMoney(item.taxableAmount);
  const taxAmount = roundMoney(item.taxAmount);
  return {
    ...item,
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
  const items = ((sub.items as Record<string, unknown>[]) ?? []).map(mapOrderItem);
  return {
    ...sub,
    subtotal: roundMoney(sub.subtotal),
    shippingCost,
    shippingDiscountAmount,
    shippingCharged: shippingCharged(shippingCost, shippingDiscountAmount),
    taxAmount,
    taxableAmount,
    discountAmount,
    discountTotal: combinedDiscount(discountAmount, shippingDiscountAmount),
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
    items,
  };
}

export function mapOrderResponse(order: Record<string, unknown>) {
  const plain = typeof (order as { get?: () => unknown }).get === 'function'
    ? ((order as { get: (opts: { plain: boolean }) => Record<string, unknown> }).get({ plain: true }))
    : order;
  const totalAmount = roundMoney(plain.totalAmount);
  const walletAmountUsed = roundMoney(plain.walletAmountUsed);
  const originalTotalAmount = roundMoney(plain.originalTotalAmount ?? totalAmount);
  const razorpayAmountPaid = roundMoney(
    plain.razorpayAmountPaid ?? Math.max(0, originalTotalAmount - walletAmountUsed),
  );
  const subOrders = ((plain.subOrders as Record<string, unknown>[]) ?? []).map(mapSubOrder);
  const aggregates = recomputeOrderDisplayFields({
    subOrders,
    paymentMethod: plain.paymentMethod as string | null | undefined,
    totalAmount,
    walletAmountUsed,
    razorpayAmountPaid,
  });
  return {
    ...plain,
    totalAmount,
    discountTotal: roundMoney(plain.discountTotal),
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
    pendingCashbackAmount: roundMoney(plain.pendingCashbackAmount),
    cashbackCreditedAt: plain.cashbackCreditedAt ?? null,
    cashbackDiscountBearer: plain.cashbackDiscountBearer ?? null,
    paymentMethod: plain.paymentMethod ?? null,
    cancelRefundStatus: plain.cancelRefundStatus ?? null,
    cancelRazorpayRefundId: plain.cancelRazorpayRefundId ?? null,
    customerName: (plain.user as { name?: string } | undefined)?.name ?? null,
    subOrders,
  };
}
