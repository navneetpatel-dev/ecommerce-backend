import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { REFUND_STATUS } from '@core/constants/statuses';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { paymentsService } from '@modules/payments/payments.service';
import { toPaise } from '@modules/pricing/money';
import { notificationsService } from '@modules/notifications/notifications.service';

/** A return's card share, frozen in the refund transaction and sent to Razorpay after it. */
export type PendingReturnCardRefund = { returnId: string; paymentId: string; amountPaise: number };

/**
 * Sends a return's card share to Razorpay, after the transaction that froze it committed.
 * A failure is recorded on the return (FAILED, for the retry job) and rethrown as
 * "refund pending", so the caller's request reports it.
 */
export async function sendReturnCardRefund(
  pending: PendingReturnCardRefund,
  orderItemId: string,
  slaDays: number,
): Promise<void> {
  try {
    const refundId = await paymentsService.createRazorpayRefund(pending.paymentId, pending.amountPaise, {
      returnRequestId: pending.returnId,
    });
    await ReturnRequest.update(
      { razorpayRefundId: refundId, refundStatus: REFUND_STATUS.INITIATED },
      { where: { id: pending.returnId } },
    );
    const orderItem = await OrderItem.findByPk(orderItemId, {
      include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
    });
    const order = (orderItem as (OrderItem & { subOrder?: SubOrder & { order?: Order } }) | null)?.subOrder
      ?.order;
    if (order?.userId) {
      void notificationsService.sendRefundInitiated(order.userId, pending.returnId, {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
        amount: Number(pending.amountPaise) / 100,
        slaDays,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund failed';
    const failedRow = await ReturnRequest.findByPk(pending.returnId);
    if (failedRow) {
      await failedRow.update({
        refundStatus: REFUND_STATUS.FAILED,
        refundAttemptCount: Number(failedRow.refundAttemptCount ?? 0) + 1,
        lastRefundAttemptAt: new Date(),
        refundFailureReason: message.slice(0, 255),
      });
    }
    throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
  }
}

/**
 * Retries a return's card refund that failed. Claimed first, so the retry job and an admin
 * retrying at once cannot both refund the card.
 */
export async function retryReturnCardRefund(returnRequestId: string, actorId: string): Promise<void> {
  const row = await ReturnRequest.findByPk(returnRequestId);
  if (!row) throw new NotFoundError('ReturnRequest');
  if (row.refundStatus !== REFUND_STATUS.FAILED) {
    throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_RETRY_FAILED_ONLY);
  }
  const razorpayAmount = Number(row.razorpayRefundAmount ?? 0);
  if (razorpayAmount <= 0) {
    throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_REFUND);
  }

  const orderItem = await OrderItem.findByPk(row.orderItemId, {
    include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
  });
  const order = (orderItem as (OrderItem & { subOrder?: SubOrder & { order?: Order } }) | null)?.subOrder?.order;
  const paymentId = order?.razorpayPaymentId;
  if (!paymentId) throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_PAYMENT);

  // Claim the retry so the job and an admin retrying at once cannot both refund the card.
  const [claimed] = await ReturnRequest.update(
    { refundStatus: REFUND_STATUS.PENDING },
    { where: { id: row.id, refundStatus: REFUND_STATUS.FAILED } },
  );
  if (claimed === 0) throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_RETRY_FAILED_ONLY);

  const amountPaise = toPaise(razorpayAmount);
  try {
    const refundId = await paymentsService.createRazorpayRefund(paymentId, amountPaise, {
      returnRequestId: row.id,
    });
    await row.update({
      razorpayRefundId: refundId,
      refundStatus: REFUND_STATUS.INITIATED,
      refundFailureReason: null,
      updatedBy: actorId === 'system' ? row.userId : actorId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund failed';
    await row.update({
      refundStatus: REFUND_STATUS.FAILED,
      refundAttemptCount: Number(row.refundAttemptCount ?? 0) + 1,
      lastRefundAttemptAt: new Date(),
      refundFailureReason: message.slice(0, 255),
      updatedBy: actorId === 'system' ? row.userId : actorId,
    });
    throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
  }
}
