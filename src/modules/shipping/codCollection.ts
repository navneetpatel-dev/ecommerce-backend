import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { ORDER_STATUS } from '@core/constants/statuses';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { fromPaise, toPaise, type Paise } from '@modules/pricing/money';
import { walletShareOfRefundPaise, type RefundSplitOrder } from '@modules/pricing/refundSplit';
import { isReversedPart } from '@modules/pricing/partReversal';

/** The order fields the COD amount reads. */
export type CodOrder = RefundSplitOrder & { id: string; giftWrapFeeAmount?: unknown };

/**
 * Cash the delivery agent collects for one COD shipment, in paise.
 *
 * The customer owes, at the door, the parts they kept (every sub-order not cancelled or
 * back undelivered — RTO) plus the order-level gift-wrap fee, less the wallet money
 * applied to them: the wallet paid at checkout minus the wallet shares already returned
 * for reversed parts. A parcel refused before the others ship leaves the fee it carried
 * to the next one. That
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
  // Cancelled and RTO'd (RETURNED) parts were reversed: they owe no cash and their
  // wallet share went back to the wallet.
  const kept = subOrders.filter((sub) => !isReversedPart(sub.status));
  const cancelled = subOrders.filter((sub) => isReversedPart(sub.status));
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

/**
 * SQL twin of the amount `codAmountForSubOrderPaise` splits across the shipments, in
 * paise (alias = orders): the cash still owed at the door for the parts kept — every
 * sub-order not cancelled or back undelivered (RTO) — plus the gift-wrap fee, less the
 * wallet money on them (wallet paid at checkout less each reversed part's wallet share,
 * as `walletShareOfRefundPaise` computes it). 0 once no part is kept.
 */
export function sqlCodCashDuePaise(alias: string): string {
  const walletPaise = `ROUND(COALESCE(${alias}."walletAmountUsed", 0)::numeric * 100)`;
  const checkoutTotalPaise = `GREATEST(
    ROUND(COALESCE(${alias}."originalTotalAmount", 0)::numeric * 100),
    ROUND(COALESCE(${alias}."razorpayAmountPaid", 0)::numeric * 100) + ${walletPaise},
    ROUND(COALESCE(${alias}."totalAmount", 0)::numeric * 100),
    ${walletPaise}
  )`;
  const partPaise = `ROUND(COALESCE(cs."customerTotal", 0)::numeric * 100)`;
  const reversed = `cs."status" IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')`;
  return `(SELECT CASE
      WHEN COUNT(*) FILTER (WHERE NOT (${reversed})) = 0 THEN 0
      ELSE GREATEST(0,
        COALESCE(SUM(${partPaise}) FILTER (WHERE NOT (${reversed})), 0)
        + ROUND(COALESCE(${alias}."giftWrapFeeAmount", 0)::numeric * 100)
        - GREATEST(0, ${walletPaise} - COALESCE(SUM(
            CASE WHEN ${walletPaise} > 0 AND ${checkoutTotalPaise} > 0 AND ${partPaise} > 0
              THEN LEAST(${partPaise}, ROUND(${partPaise} * ${walletPaise} / ${checkoutTotalPaise}))
              ELSE 0 END
          ) FILTER (WHERE ${reversed}), 0)))
    END
    FROM sub_orders cs
    WHERE cs."orderId" = ${alias}.id AND cs."deletedAt" IS NULL)::bigint`;
}
