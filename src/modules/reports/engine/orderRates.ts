import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_STATUS, RETURN_STATUS } from '@core/constants/statuses';
import { PAID_OR_COD_ORDER_SQL } from '@modules/pricing/frozenMoneySql';

export type OrderRates = {
  /** Orders actually placed: COD, or paid online (an abandoned or failed checkout is not). */
  placedOrders: number;
  /** Their parts (sub-orders): the base of the cancellation rate. */
  placedParts: number;
  /** Parts cancelled, whether the whole order or only that part was. */
  cancelledParts: number;
  /** Parts delivered: the base of the return rate. */
  deliveredParts: number;
  /** Delivered parts with a return that was accepted (not still requested, not rejected). */
  returnedParts: number;
  /** Accepted return requests on those parts. */
  returnCount: number;
  /** Percent, one decimal. */
  cancellationRate: number;
  returnRate: number;
};

function percent(part: number, whole: number): number {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;
}

/**
 * Cancellation and return rates on orders placed (in the range, when given): cancelled
 * parts over placed parts — so a partial cancellation counts — and delivered parts with
 * an accepted return over delivered parts. Unpaid or failed online checkouts are not
 * orders, and a rejected (or still pending) return request is not a return.
 */
export async function queryOrderRates(range?: { from: Date; to: Date }): Promise<OrderRates> {
  const [row] = await sequelize.query<Record<string, string | number | null>>(
    `WITH placed_parts AS (
       SELECT s.id, s."orderId", s.status
       FROM sub_orders s
       INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
       WHERE s."deletedAt" IS NULL
         AND ${PAID_OR_COD_ORDER_SQL}
         ${range ? 'AND o."createdAt" BETWEEN :from AND :to' : ''}
     ),
     accepted_returns AS (
       SELECT rr."subOrderId", COUNT(*)::int AS n
       FROM return_requests rr
       INNER JOIN placed_parts p ON p.id = rr."subOrderId"
       WHERE rr."deletedAt" IS NULL
         AND rr.status NOT IN ('${RETURN_STATUS.REQUESTED}', '${RETURN_STATUS.REJECTED}')
       GROUP BY rr."subOrderId"
     )
     SELECT
       COUNT(DISTINCT p."orderId")::int AS "placedOrders",
       COUNT(*)::int AS "placedParts",
       COUNT(*) FILTER (WHERE p.status = '${ORDER_STATUS.CANCELLED}')::int AS "cancelledParts",
       COUNT(*) FILTER (WHERE p.status = '${ORDER_STATUS.DELIVERED}')::int AS "deliveredParts",
       COUNT(*) FILTER (
         WHERE p.status = '${ORDER_STATUS.DELIVERED}' AND ar.n IS NOT NULL
       )::int AS "returnedParts",
       COALESCE(SUM(ar.n) FILTER (WHERE p.status = '${ORDER_STATUS.DELIVERED}'), 0)::int AS "returnCount"
     FROM placed_parts p
     LEFT JOIN accepted_returns ar ON ar."subOrderId" = p.id`,
    {
      replacements: range ? { from: range.from, to: range.to } : {},
      type: QueryTypes.SELECT,
    },
  );
  const n = (key: string) => Number(row?.[key] ?? 0);
  return {
    placedOrders: n('placedOrders'),
    placedParts: n('placedParts'),
    cancelledParts: n('cancelledParts'),
    deliveredParts: n('deliveredParts'),
    returnedParts: n('returnedParts'),
    returnCount: n('returnCount'),
    cancellationRate: percent(n('cancelledParts'), n('placedParts')),
    returnRate: percent(n('returnedParts'), n('deliveredParts')),
  };
}
