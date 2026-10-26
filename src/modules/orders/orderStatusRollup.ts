import type { Transaction } from 'sequelize';
import { ORDER_STATUS, type OrderStatus } from '@core/constants/statuses';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { isReversedPart } from '@modules/pricing/partReversal';

/**
 * The order's status from its parts' (sub-orders'), or null to leave it as it is.
 * - every part settled: DELIVERED if any was delivered, RETURNED if all came back
 *   undelivered (RTO), otherwise CANCELLED;
 * - every part still going has left the seller: SHIPPED;
 * - otherwise the order keeps its own status (PENDING / CONFIRMED).
 */
export function orderStatusFromParts(statuses: string[]): OrderStatus | null {
  if (statuses.length === 0) return null;
  const live = statuses.filter((status) => !isReversedPart(status));
  if (live.every((status) => status === ORDER_STATUS.DELIVERED)) {
    if (live.length > 0) return ORDER_STATUS.DELIVERED;
    return statuses.every((status) => status === ORDER_STATUS.RETURNED)
      ? ORDER_STATUS.RETURNED
      : ORDER_STATUS.CANCELLED;
  }
  if (live.every((status) => status === ORDER_STATUS.SHIPPED || status === ORDER_STATUS.DELIVERED)) {
    return ORDER_STATUS.SHIPPED;
  }
  return null;
}

/**
 * Brings the order's status in line with its parts after one of them moved (shipped,
 * delivered, cancelled, came back). Without it an order stayed CONFIRMED once shipped,
 * and for good when one part was delivered and another cancelled. An order nothing was
 * delivered on owes no cashback.
 */
export async function rollUpOrderStatus(orderId: string, transaction: Transaction): Promise<void> {
  const parts = await SubOrder.findAll({ where: { orderId }, attributes: ['status'], transaction });
  const target = orderStatusFromParts(parts.map((part) => part.status));
  if (!target) return;
  const nothingDelivered = target === ORDER_STATUS.CANCELLED || target === ORDER_STATUS.RETURNED;
  await Order.update(
    { status: target, ...(nothingDelivered ? { pendingCashbackAmount: 0 } : {}) },
    { where: { id: orderId }, transaction },
  );
}
