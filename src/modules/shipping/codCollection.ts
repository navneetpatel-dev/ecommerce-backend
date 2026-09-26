import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { ORDER_STATUS } from '@core/constants/statuses';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { fromPaise, toPaise, type Paise } from '@modules/pricing/money';
import { walletShareOfRefundPaise, type RefundSplitOrder } from '@modules/pricing/refundSplit';

/** The order fields the COD amount reads. */
export type CodOrder = RefundSplitOrder & { id: string; giftWrapFeeAmount?: unknown };

/**
 * Cash the delivery agent collects for one COD shipment, in paise.
 *
 * The customer owes, at the door, the parts they kept (every sub-order not cancelled)
 * plus the order-level gift-wrap fee, less the wallet money applied to them: the wallet
 * paid at checkout minus the wallet shares already returned for cancelled parts. That
 * total is split across the shipments in proportion to what each carries; the gift-wrap
 * fee rides on the first shipment, and the last one takes the remainder, so the cash
 * collected adds up to exactly what is owed.
 */
export async function codAmountForSubOrderPaise(
  order: CodOrder,
  subOrderId: string,
  transaction?: Transaction,
): Promise<Paise> {
  const subOrders = await SubOrder.findAll({
    where: { orderId: order.id },
    attributes: ['id', 'status', 'customerTotal'],
    transaction,
  });
  const totalPaise = (sub: SubOrder) => toPaise(Number(sub.customerTotal ?? 0));
  const kept = subOrders.filter((sub) => sub.status !== ORDER_STATUS.CANCELLED);
  const cancelled = subOrders.filter((sub) => sub.status === ORDER_STATUS.CANCELLED);
  const current = kept.find((sub) => sub.id === subOrderId);
  if (!current) return 0;

  const feePaise = toPaise(Number(order.giftWrapFeeAmount ?? 0));
  const keptPaise = kept.reduce((sum, sub) => sum + totalPaise(sub), 0) + feePaise;
  const walletReturnedPaise = cancelled.reduce(
    (sum, sub) => sum + walletShareOfRefundPaise(order, totalPaise(sub)),
    0,
  );
  const walletOnKeptPaise = Math.max(
    0,
    toPaise(Number(order.walletAmountUsed ?? 0)) - walletReturnedPaise,
  );
  const duePaise = Math.max(0, keptPaise - walletOnKeptPaise);

  const others = kept.filter((sub) => sub.id !== subOrderId);
  const shipped = others.length
    ? await Shipment.findAll({
        where: { subOrderId: { [Op.in]: others.map((sub) => sub.id) } },
        attributes: ['subOrderId', 'codAmount'],
        transaction,
      })
    : [];
  const assignedPaise = shipped.reduce((sum, row) => sum + toPaise(Number(row.codAmount ?? 0)), 0);

  // The last kept part to ship collects whatever is still owed.
  if (shipped.length >= others.length) return Math.max(0, duePaise - assignedPaise);

  const share = (partPaise: Paise) =>
    keptPaise > 0 ? Math.round((duePaise * partPaise) / keptPaise) : 0;
  const first = shipped.length === 0;
  const ownPaise = share(totalPaise(current)) + (first ? share(feePaise) : 0);
  return Math.min(ownPaise, Math.max(0, duePaise - assignedPaise));
}

/** `codAmountForSubOrderPaise` in rupees, for the Shipment.codAmount column. */
export async function codAmountForSubOrder(
  order: CodOrder,
  subOrderId: string,
  transaction?: Transaction,
): Promise<number> {
  return fromPaise(await codAmountForSubOrderPaise(order, subOrderId, transaction));
}
