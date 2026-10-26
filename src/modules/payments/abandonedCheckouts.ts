import { Op } from 'sequelize';
import { env } from '@config/env';
import { Order } from '@database/models/order.model';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { paymentsService } from './payments.service';
import { razorpayOrderPayments } from './razorpayOrderPayments';
import { unpaidOrders } from './unpaidOrderCancel';

const BATCH_SIZE = 100;
/** Batches per run: enough to get past orders it must leave alone, bounded per run. */
const MAX_BATCHES = 20;

export type AbandonedCheckoutRun = { expired: number; reconciled: number; skipped: number };

/**
 * Settles online checkouts still awaiting payment after
 * `CHECKOUT_PENDING_PAYMENT_TTL_MINUTES`:
 * - Razorpay holds a captured payment (its webhook never landed): the order is
 *   confirmed, as the webhook would have done.
 * - nobody paid: the order is cancelled, giving back the stock and the wallet money.
 * - a payment is only authorized, or Razorpay can't be asked: left for the next run.
 * Pages by (createdAt, id), so orders left alone never hold back newer ones.
 */
export async function expireAbandonedCheckouts(now = new Date()): Promise<AbandonedCheckoutRun> {
  const cutoff = new Date(now.getTime() - env.CHECKOUT_PENDING_PAYMENT_TTL_MINUTES * 60 * 1000);
  const run: AbandonedCheckoutRun = { expired: 0, reconciled: 0, skipped: 0 };
  let after: { createdAt: Date; id: string } | null = null;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const cursor: { createdAt: Date; id: string } | null = after;
    const stale: Order[] = await Order.findAll({
      where: {
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        paymentStatus: PAYMENT_STATUS.PENDING,
        status: { [Op.ne]: ORDER_STATUS.CANCELLED },
        createdAt: { [Op.lt]: cutoff },
        ...(cursor
          ? {
              [Op.or]: [
                { createdAt: { [Op.gt]: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
              ],
            }
          : {}),
      },
      attributes: ['id', 'userId', 'razorpayOrderId', 'createdAt'],
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: BATCH_SIZE,
    });
    for (const order of stale) await settleAbandonedCheckout(order, run);
    if (stale.length < BATCH_SIZE) break;
    const last = stale[stale.length - 1]!;
    after = { createdAt: last.createdAt, id: last.id };
  }
  return run;
}

async function settleAbandonedCheckout(order: Order, run: AbandonedCheckoutRun): Promise<void> {
  if (order.razorpayOrderId) {
    const gateway = await razorpayOrderPayments.fetch(order.razorpayOrderId);
    if (!gateway || (!gateway.captured && gateway.authorized)) {
      run.skipped += 1;
      return;
    }
    if (gateway.captured) {
      await paymentsService.confirmCapturedPayment(gateway.captured);
      run.reconciled += 1;
      return;
    }
  }
  const cancelledOrderId = await unpaidOrders.cancel({ id: order.id });
  if (cancelledOrderId) {
    run.expired += 1;
    void notificationsService.sendOrderCancelled(order.userId, cancelledOrderId, {
      orderId: cancelledOrderId,
      orderNumber: cancelledOrderId.slice(0, 8).toUpperCase(),
    });
  }
}
