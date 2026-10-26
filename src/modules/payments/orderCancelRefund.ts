import { literal, Op } from 'sequelize';
import { REFUND_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { logger } from '@core/logger';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ReturnRequest } from '@database/models/returnRequest.model';

/** How many times the refund-retry job tries an order's cancel refund before leaving it to an admin. */
export const ORDER_REFUND_MAX_ATTEMPTS = 5;

/** A refund marked started this long ago with no Razorpay refund id never reached Razorpay. */
const STALLED_REFUND_MS = 30 * 60 * 1000;

/** Fields that record one more failed try of an order's cancel refund. */
export function failedOrderRefundAttempt() {
  return {
    cancelRefundStatus: REFUND_STATUS.FAILED,
    cancelRefundAttemptCount: literal('"cancelRefundAttemptCount" + 1') as unknown as number,
    cancelRefundLastAttemptAt: new Date(),
  };
}

/**
 * Retries a whole-order cancellation refund that failed (an admin, or the refund-retry
 * job). Only an order's own refund: one that follows its parts' refunds (a cancel done
 * part by part) is retried per part. Safe to repeat: refunds are matched by purpose.
 */
export async function retryOrderCancelRefund(orderId: string): Promise<Order> {
  const order = await Order.findByPk(orderId);
  if (!order) throw new NotFoundError('Order');
  const amountPaise = Number(order.cancelRefundAmountPaise ?? 0);
  if (order.cancelRefundStatus !== REFUND_STATUS.FAILED || amountPaise <= 0) {
    throw new ValidationError({ cancelRefundStatus: ['Only a failed order refund can be retried'] });
  }
  if (!order.razorpayPaymentId) throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_PAYMENT);
  const failedPart = await SubOrder.count({
    where: { orderId, cancelRefundStatus: REFUND_STATUS.FAILED },
  });
  if (failedPart > 0) {
    throw new ValidationError({ cancelRefundStatus: ["Retry this order's refund from its cancelled parts"] });
  }

  // Claim the retry so the job and an admin cannot both refund the card.
  const [claimed] = await Order.update(
    { cancelRefundStatus: REFUND_STATUS.PENDING },
    { where: { id: orderId, cancelRefundStatus: REFUND_STATUS.FAILED } },
  );
  if (claimed === 0) {
    throw new ValidationError({ cancelRefundStatus: ['Only a failed order refund can be retried'] });
  }

  try {
    const { paymentsService } = await import('./payments.service');
    const refundId = await paymentsService.createRazorpayRefund(order.razorpayPaymentId, amountPaise, {
      orderId,
      reason: 'ORDER_CANCEL',
    });
    await Order.update(
      { cancelRefundStatus: REFUND_STATUS.INITIATED, cancelRazorpayRefundId: refundId },
      { where: { id: orderId } },
    );
  } catch (error) {
    logger.warn('Order cancel refund retry failed', {
      orderId,
      reason: error instanceof Error ? error.message : String(error),
    });
    await Order.update(failedOrderRefundAttempt(), { where: { id: orderId } });
    throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
  }
  return order.reload();
}

/** The refund-retry job's pass over failed order refunds, oldest attempt first. */
export async function retryFailedOrderCancelRefunds(limit = 50): Promise<{ retried: number; failed: number }> {
  const orders = await Order.findAll({
    where: {
      cancelRefundStatus: REFUND_STATUS.FAILED,
      cancelRefundAmountPaise: { [Op.gt]: 0 },
      cancelRefundAttemptCount: { [Op.lt]: ORDER_REFUND_MAX_ATTEMPTS },
    },
    attributes: ['id'],
    order: [['cancelRefundLastAttemptAt', 'ASC NULLS FIRST']],
    limit,
  });
  let retried = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      await retryOrderCancelRefund(order.id);
      retried += 1;
    } catch {
      failed += 1;
    }
  }
  return { retried, failed };
}

/**
 * Card refunds marked started (the row commits before Razorpay is called) that never got
 * a Razorpay refund id: the process stopped in between. Marked FAILED so the retry job
 * picks them up; a refund that did reach Razorpay is adopted, not repeated.
 */
export async function failStalledRefunds(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - STALLED_REFUND_MS);
  const [returns] = await ReturnRequest.update(
    { refundStatus: REFUND_STATUS.FAILED, lastRefundAttemptAt: now },
    {
      where: {
        refundStatus: { [Op.in]: [REFUND_STATUS.PENDING, REFUND_STATUS.INITIATED] },
        razorpayRefundId: null,
        razorpayRefundAmount: { [Op.gt]: 0 },
        updatedAt: { [Op.lt]: before },
      },
    },
  );
  const [parts] = await SubOrder.update(
    { cancelRefundStatus: REFUND_STATUS.FAILED, cancelRefundLastAttemptAt: now },
    {
      where: {
        cancelRefundStatus: REFUND_STATUS.PENDING,
        cancelRazorpayRefundId: null,
        cancelRefundAmountPaise: { [Op.gt]: 0 },
        updatedAt: { [Op.lt]: before },
      },
    },
  );
  const [orders] = await Order.update(
    { cancelRefundStatus: REFUND_STATUS.FAILED, cancelRefundLastAttemptAt: now },
    {
      where: {
        cancelRefundStatus: REFUND_STATUS.PENDING,
        cancelRazorpayRefundId: null,
        cancelRefundAmountPaise: { [Op.gt]: 0 },
        updatedAt: { [Op.lt]: before },
      },
    },
  );
  const stalled = returns + parts + orders;
  if (stalled > 0) logger.warn('Stalled card refunds marked for retry', { returns, parts, orders });
  return stalled;
}
