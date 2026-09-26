import type { Transaction } from 'sequelize';
import { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { logger } from '@core/logger';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { isReversedPart } from '@modules/pricing/partReversal';
import type { Paise } from '@modules/pricing/money';

/**
 * Card (Razorpay) refunds for reversed parts — a part cancelled before dispatch or
 * returned undelivered (RTO). Each part records what it refunded, the Razorpay refund
 * id and where the refund stands, so a failed refund is visible and can be retried.
 * The order's own refund status follows its last part, as before.
 */

/** Record, inside the reversing transaction, that this part is owed a card refund. */
export async function markPartCardRefundPending(
  subOrderId: string,
  amountPaise: Paise,
  transaction: Transaction,
): Promise<void> {
  await SubOrder.update(
    {
      cancelRefundAmountPaise: amountPaise,
      cancelRefundStatus: REFUND_STATUS.PENDING,
      cancelRazorpayRefundId: null,
    },
    { where: { id: subOrderId }, transaction },
  );
}

/**
 * Issue the card refund for a part and record the outcome on it (and on the order when
 * `lastPart`). Run after the reversing transaction commits. Never throws: a failure is
 * recorded as FAILED for an admin to retry. Returns the refund id when issued.
 */
export async function issuePartCardRefund(input: {
  orderId: string;
  subOrderId: string;
  paymentId: string;
  amountPaise: Paise;
  lastPart: boolean;
}): Promise<string | null> {
  try {
    const { paymentsService } = await import('./payments.service');
    const refundId = await paymentsService.createRazorpayRefund(input.paymentId, input.amountPaise, {
      orderId: input.orderId,
      // Settled like a cancellation (see the refund.processed webhook).
      reason: 'SUBORDER_CANCEL',
      subOrderId: input.subOrderId,
    });
    await SubOrder.update(
      { cancelRefundStatus: REFUND_STATUS.INITIATED, cancelRazorpayRefundId: refundId },
      { where: { id: input.subOrderId } },
    );
    if (input.lastPart) {
      await Order.update(
        { cancelRefundStatus: REFUND_STATUS.INITIATED, cancelRazorpayRefundId: refundId },
        { where: { id: input.orderId } },
      );
    }
    return refundId;
  } catch (error) {
    logger.warn('Part card refund failed', {
      orderId: input.orderId,
      subOrderId: input.subOrderId,
      amountPaise: input.amountPaise,
      reason: error instanceof Error ? error.message : String(error),
    });
    await SubOrder.update(
      { cancelRefundStatus: REFUND_STATUS.FAILED },
      { where: { id: input.subOrderId } },
    );
    if (input.lastPart) {
      await Order.update(
        { cancelRefundStatus: REFUND_STATUS.FAILED },
        { where: { id: input.orderId } },
      );
    }
    return null;
  }
}

/**
 * The refund.processed webhook for a part's refund: mark the part refunded, and once
 * every part of a fully reversed order has its card refund settled, the order too.
 */
export async function markPartCardRefundProcessed(input: {
  orderId: string;
  subOrderId: string;
  refundId: string;
}): Promise<void> {
  await SubOrder.update(
    { cancelRefundStatus: REFUND_STATUS.COMPLETED },
    { where: { id: input.subOrderId, orderId: input.orderId, cancelRazorpayRefundId: input.refundId } },
  );

  const order = await Order.findByPk(input.orderId, { attributes: ['id', 'status', 'cancelRazorpayRefundId'] });
  if (!order) return;
  // Cancelled, or every part came back undelivered (RTO).
  if (order.status !== ORDER_STATUS.CANCELLED && order.status !== ORDER_STATUS.RETURNED) return;
  const parts = await SubOrder.findAll({
    where: { orderId: input.orderId },
    attributes: ['id', 'status', 'cancelRefundAmountPaise', 'cancelRefundStatus'],
  });
  const tracked = parts.filter((part) => Number(part.cancelRefundAmountPaise ?? 0) > 0);
  const allSettled =
    parts.every((part) => isReversedPart(part.status)) &&
    tracked.every((part) => part.cancelRefundStatus === REFUND_STATUS.COMPLETED);
  // Refunds issued before per-part tracking match the order's own refund id instead.
  if (allSettled && (tracked.length > 0 || order.cancelRazorpayRefundId === input.refundId)) {
    await Order.update(
      { paymentStatus: PAYMENT_STATUS.REFUNDED, cancelRefundStatus: REFUND_STATUS.COMPLETED },
      { where: { id: input.orderId } },
    );
  }
}

/** Admin retry of a part's failed card refund. */
export async function retryPartCardRefund(subOrderId: string): Promise<SubOrder> {
  const part = await SubOrder.findByPk(subOrderId);
  if (!part) throw new NotFoundError('SubOrder');
  if (part.cancelRefundStatus !== REFUND_STATUS.FAILED) {
    throw new ValidationError(ERROR_MESSAGES.PART_REFUND_RETRY_FAILED_ONLY);
  }
  const amountPaise = Number(part.cancelRefundAmountPaise ?? 0);
  const order = await Order.findByPk(part.orderId);
  const paymentId = order?.razorpayPaymentId;
  if (!order || !paymentId || amountPaise <= 0) {
    throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_PAYMENT);
  }

  const siblings = await SubOrder.findAll({
    where: { orderId: order.id },
    attributes: ['id', 'status', 'cancelRefundStatus'],
  });
  // The order's refund status is FAILED only through its last part; once no part is
  // still failed, it follows this refund.
  const otherFailed = siblings.some(
    (sibling) => sibling.id !== part.id && sibling.cancelRefundStatus === REFUND_STATUS.FAILED,
  );
  const lastPart =
    order.cancelRefundStatus === REFUND_STATUS.FAILED &&
    siblings.every((sibling) => isReversedPart(sibling.status)) &&
    !otherFailed;

  // Claim the retry so two concurrent retries cannot both refund the card.
  const [claimed] = await SubOrder.update(
    { cancelRefundStatus: REFUND_STATUS.PENDING },
    { where: { id: part.id, cancelRefundStatus: REFUND_STATUS.FAILED } },
  );
  if (claimed === 0) throw new ValidationError(ERROR_MESSAGES.PART_REFUND_RETRY_FAILED_ONLY);

  const refundId = await issuePartCardRefund({
    orderId: order.id,
    subOrderId: part.id,
    paymentId,
    amountPaise,
    lastPart,
  });
  if (!refundId) throw new ValidationError(ERROR_MESSAGES.PART_REFUND_FAILED);
  return part.reload();
}
