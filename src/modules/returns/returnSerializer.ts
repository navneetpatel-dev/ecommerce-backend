import { REFUND_STATUS, RETURN_STATUS, RETURN_TYPE } from '@core/constants/statuses';
import type { ReturnRequest } from '@database/models/returnRequest.model';
import type { OrderItem } from '@database/models/orderItem.model';
import { orderReference } from '@modules/orders/orderReference';
import { toPlain, type PlainRow } from '@core/repository/toPlain';

type NoteRef = { id: string; number: string; againstInvoiceNumber?: string | null };

/** A return row with the order, customer and note relations its queries include. */
type PlainReturn = PlainRow<
  ReturnRequest,
  {
    orderReference?: string | null;
    CreditNote?: NoteRef | null;
    creditNote?: NoteRef | null;
    DebitNote?: NoteRef | null;
    debitNote?: NoteRef | null;
    subOrder?: { orderId?: string | null } | null;
    orderItem?: { productName?: string | null } | null;
    user?: { name?: string | null } | null;
  }
>;

/** A return as the API sends it, with the customer-facing refund message. */
export function serializeReturn(
  row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem }),
  slaDays: number,
  /** Cashback taken back from the wallet for this return (rupees), when looked up. */
  cashbackClawback?: number,
) {
  const plain = toPlain<PlainReturn>(row);
  const creditNote = plain.CreditNote ?? plain.creditNote ?? null;
  const debitNote = plain.DebitNote ?? plain.debitNote ?? null;
  const rawRefundStatus = plain.refundStatus ?? REFUND_STATUS.NONE;
  const refundStatus =
    plain.status === RETURN_STATUS.REFUNDED && rawRefundStatus === REFUND_STATUS.NONE
      ? REFUND_STATUS.COMPLETED
      : rawRefundStatus;
  const orderRef =
    plain.orderReference != null
      ? (String(plain.orderReference).startsWith('#') ? plain.orderReference : `#${plain.orderReference}`)
      : plain.subOrder?.orderId
        ? `#${orderReference(plain.subOrder.orderId)}`
        : null;
  const returnRef = plain.id ? `#RET-${String(plain.id).slice(0, 8).toUpperCase()}` : null;
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
    returnReference: returnRef,
    orderReference: orderRef,
    orderItemId: plain.orderItemId,
    subOrderId: plain.subOrderId ?? null,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    returnQuantity: plain.returnQuantity != null ? Number(plain.returnQuantity) : null,
    status: plain.status,
    type: plain.type ?? RETURN_TYPE.REFUND,
    rejectionReason: plain.rejectionReason ?? null,
    replacementDeliveredAt: plain.replacementDeliveredAt ?? null,
    photoUrls: Array.isArray(plain.photoUrls) ? plain.photoUrls : [],
    refundMethod: plain.refundMethod ?? null,
    refundStatus,
    refundCustomerMessage,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    /** Held back because the items kept no longer qualify for the offer (rupees). */
    offerAdjustment: plain.offerAdjustmentPaise != null ? Number(plain.offerAdjustmentPaise) / 100 : null,
    cashbackClawback: cashbackClawback ?? null,
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
    disputeReason: plain.disputeReason ?? null,
    disputeDescription: plain.disputeDescription ?? null,
    disputeEvidenceUrls: Array.isArray(plain.disputeEvidenceUrls) ? plain.disputeEvidenceUrls : [],
    disputedAt: plain.disputedAt ?? null,
    disputeStatus: plain.disputeStatus ?? null,
    disputeResolvedAt: plain.disputeResolvedAt ?? null,
    disputeResolutionNotes: plain.disputeResolutionNotes ?? null,
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

/** Lean summary of a return for table list views. Excludes heavy payloads (photos, dispute logs, detailed clawbacks). */
export function serializeReturnSummary(
  row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem }),
  _slaDays?: number,
  cashbackClawback?: number,
) {
  const plain = toPlain<PlainReturn>(row);
  const creditNote = plain.CreditNote ?? plain.creditNote ?? null;
  const debitNote = plain.DebitNote ?? plain.debitNote ?? null;
  const rawRefundStatus = plain.refundStatus ?? REFUND_STATUS.NONE;
  const refundStatus =
    plain.status === RETURN_STATUS.REFUNDED && rawRefundStatus === REFUND_STATUS.NONE
      ? REFUND_STATUS.COMPLETED
      : rawRefundStatus;
  const orderRef =
    plain.orderReference != null
      ? (String(plain.orderReference).startsWith('#') ? plain.orderReference : `#${plain.orderReference}`)
      : plain.subOrder?.orderId
        ? `#${orderReference(plain.subOrder.orderId)}`
        : null;
  const returnRef = plain.id ? `#RET-${String(plain.id).slice(0, 8).toUpperCase()}` : null;

  return {
    id: plain.id,
    returnReference: returnRef,
    orderReference: orderRef,
    orderItemId: plain.orderItemId,
    subOrderId: plain.subOrderId ?? null,
    reasonCode: plain.reasonCode,
    type: plain.type ?? RETURN_TYPE.REFUND,
    status: plain.status,
    refundStatus,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    /** Held back because the items kept no longer qualify for the offer (rupees). */
    offerAdjustment: plain.offerAdjustmentPaise != null ? Number(plain.offerAdjustmentPaise) / 100 : null,
    cashbackClawback: cashbackClawback ?? null,
    photoCount: Array.isArray(plain.photoUrls) ? plain.photoUrls.length : 0,
    disputeStatus: plain.disputeStatus ?? null,
    productName: plain.orderItem?.productName ?? null,
    customerName: plain.user?.name ?? null,
    creditNoteNumber: creditNote?.number ?? null,
    debitNoteNumber: debitNote?.number ?? null,
    createdAt: plain.createdAt,
  };
}
