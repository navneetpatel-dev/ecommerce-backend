import { REFUND_STATUS, RETURN_STATUS, RETURN_TYPE } from '@core/constants/statuses';
import type { ReturnRequest } from '@database/models/returnRequest.model';
import type { OrderItem } from '@database/models/orderItem.model';

/** A return as the API sends it, with the customer-facing refund message. */
export function serializeReturn(
  row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem }),
  slaDays: number,
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const creditNote = plain.CreditNote ?? plain.creditNote ?? null;
  const debitNote = plain.DebitNote ?? plain.debitNote ?? null;
  const refundStatus = plain.refundStatus ?? REFUND_STATUS.NONE;
  let refundCustomerMessage: string | null = null;
  if (refundStatus === REFUND_STATUS.INITIATED) {
    refundCustomerMessage = `Refund initiated — bank posting may take ${slaDays} business days.`;
  } else if (refundStatus === REFUND_STATUS.FAILED) {
    refundCustomerMessage = 'There was an issue processing your bank refund. Our team is retrying.';
  } else if (refundStatus === REFUND_STATUS.COMPLETED) {
    refundCustomerMessage = 'Refund completed.';
  } else if (
    plain.type !== RETURN_TYPE.EXCHANGE &&
    (plain.status === RETURN_STATUS.APPROVED || plain.status === RETURN_STATUS.PICKUP_SCHEDULED)
  ) {
    // Refunds are issued on pickup, not at approval.
    refundCustomerMessage = 'Your refund is issued once the item is picked up.';
  }
  return {
    id: plain.id,
    orderItemId: plain.orderItemId,
    subOrderId: plain.subOrderId ?? null,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    returnQuantity: plain.returnQuantity != null ? Number(plain.returnQuantity) : null,
    status: plain.status,
    type: plain.type ?? RETURN_TYPE.REFUND,
    deliveryAgentId: plain.deliveryAgentId ?? null,
    pickupOtpVerifiedAt: plain.pickupOtpVerifiedAt ?? null,
    pickupFailureReason: plain.pickupFailureReason ?? null,
    rejectionReason: plain.rejectionReason ?? null,
    preferredRepickupSlot: plain.preferredRepickupSlot ?? null,
    replacementDeliveredAt: plain.replacementDeliveredAt ?? null,
    replacementProofUrl: plain.replacementProofUrl ?? null,
    photoUrls: Array.isArray(plain.photoUrls) ? plain.photoUrls : [],
    refundMethod: plain.refundMethod ?? null,
    refundStatus: plain.refundStatus ?? REFUND_STATUS.NONE,
    refundCustomerMessage,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    refundTaxAmount: plain.refundTaxAmount != null ? Number(plain.refundTaxAmount) : null,
    refundMerchandiseAmount:
      plain.refundMerchandiseAmount != null ? Number(plain.refundMerchandiseAmount) : null,
    refundCommissionAmount:
      plain.refundCommissionAmount != null ? Number(plain.refundCommissionAmount) : null,
    refundTcsAmount: plain.refundTcsAmount != null ? Number(plain.refundTcsAmount) : null,
    refundNetClawback: plain.refundNetClawback != null ? Number(plain.refundNetClawback) : null,
    walletRefundAmount: Number(plain.walletRefundAmount ?? 0),
    razorpayRefundAmount: Number(plain.razorpayRefundAmount ?? 0),
    shippingRefundAmount: Number(plain.shippingRefundAmount ?? 0),
    returnShippingFeeAmount: Number(plain.returnShippingFeeAmount ?? 0),
    razorpayRefundId: plain.razorpayRefundId ?? null,
    receivedAt: plain.receivedAt ?? null,
    restockedAt: plain.restockedAt ?? null,
    resolvedAt: plain.resolvedAt,
    createdAt: plain.createdAt,
    productName: plain.orderItem?.productName ?? null,
    customerName: plain.user?.name ?? null,
    creditNoteNumber: creditNote?.number ?? null,
    creditNoteId: creditNote?.id ?? null,
    debitNoteNumber: debitNote?.number ?? null,
    debitNoteId: debitNote?.id ?? null,
    againstInvoiceNumber:
      creditNote?.againstInvoiceNumber ?? debitNote?.againstInvoiceNumber ?? null,
  };
}
