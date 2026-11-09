import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Coupon } from '@database/models/coupon.model';
import { CashbackOffer } from '@database/models/cashbackOffer.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise, roundMoney } from '@modules/pricing/money';
import { isReversedPart } from '@modules/pricing/partReversal';
import { env } from '@config/env';

export type CashbackEntryStatus = 'PENDING' | 'CREDITED' | 'CANCELLED';

export type CashbackEntry = {
  orderId: string;
  placedAt: Date;
  /** Pending: what is expected. Credited: what is in the wallet now (after any return). */
  amount: number;
  status: CashbackEntryStatus;
  /** Once every part is delivered: when the credit job will pay it. Null before delivery. */
  expectedCreditOn: Date | null;
  creditedAt: Date | null;
  couponCodes: string[];
  offerName: string | null;
};

type OrderWithParts = Order & { subOrders?: SubOrder[] };

const DAY_MS = 86_400_000;

export function cashbackEntryFor(order: OrderWithParts, couponCodes: string[], offerName: string | null): CashbackEntry {
  const amount = roundMoney(order.pendingCashbackAmount ?? 0);
  const parts = (order.subOrders ?? []).filter((part) => !isReversedPart(part.status));
  const base = { orderId: order.id, placedAt: order.createdAt, amount, couponCodes, offerName };
  if (order.cashbackCreditedAt) {
    // A return after the credit claws it back; nothing left means it was reversed.
    const status = amount > 0 ? 'CREDITED' : 'CANCELLED';
    return { ...base, status, expectedCreditOn: null, creditedAt: order.cashbackCreditedAt };
  }
  if (order.status === ORDER_STATUS.CANCELLED || parts.length === 0) {
    return { ...base, status: 'CANCELLED', expectedCreditOn: null, creditedAt: null };
  }
  const delivered = parts.every((part) => part.status === ORDER_STATUS.DELIVERED);
  const lastSettled = Math.max(...(order.subOrders ?? []).map((part) => part.updatedAt.getTime()));
  const expectedCreditOn = delivered ? new Date(lastSettled + env.CASHBACK_CREDIT_DELAY_DAYS * DAY_MS) : null;
  return { ...base, status: 'PENDING', expectedCreditOn, creditedAt: null };
}

/** Exact totals in paise across every order, not just the page. */
async function totals(userId: string): Promise<{ pending: number; credited: number }> {
  const [row] = await sequelize.query<{ pending: string | null; credited: string | null }>(
    `SELECT
       COALESCE(SUM(ROUND(o."pendingCashbackAmount" * 100)) FILTER (
         WHERE o."cashbackCreditedAt" IS NULL AND o.status <> :cancelled
           AND EXISTS (SELECT 1 FROM sub_orders s WHERE s."orderId" = o.id AND s."deletedAt" IS NULL
                       AND s.status NOT IN (:reversed))
       ), 0) AS pending,
       COALESCE(SUM(ROUND(o."pendingCashbackAmount" * 100)) FILTER (WHERE o."cashbackCreditedAt" IS NOT NULL), 0) AS credited
     FROM orders o
     WHERE o."userId" = :userId AND o."deletedAt" IS NULL AND o.status <> :unpaid`,
    {
      replacements: {
        userId,
        cancelled: ORDER_STATUS.CANCELLED,
        unpaid: ORDER_STATUS.PENDING,
        reversed: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED],
      },
      type: QueryTypes.SELECT,
    },
  );
  return { pending: fromPaise(Number(row?.pending ?? 0)), credited: fromPaise(Number(row?.credited ?? 0)) };
}

/** A customer's cashback, order by order: pending, credited or cancelled, with the totals. */
export async function listCashbackHistory(userId: string, query: { page: number; limit: number }) {
  const where = {
    userId,
    // An unpaid checkout never earns cashback.
    status: { [Op.ne]: ORDER_STATUS.PENDING },
    [Op.or]: [{ pendingCashbackAmount: { [Op.gt]: 0 } }, { cashbackCreditedAt: { [Op.ne]: null } }],
  };
  const [count, orders, sums] = await Promise.all([
    Order.count({ where }),
    Order.findAll({
      where,
      include: [{ model: SubOrder, as: 'subOrders', attributes: ['id', 'status', 'updatedAt'] }],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset: paginationOffset(query.page, query.limit),
    }) as Promise<OrderWithParts[]>,
    totals(userId),
  ]);

  const couponIds = [...new Set(orders.flatMap((order) => order.appliedCouponIds ?? []))];
  const offerIds = [...new Set(orders.map((order) => order.cashbackOfferId).filter((id): id is string => Boolean(id)))];
  const [coupons, offers] = await Promise.all([
    couponIds.length
      ? Coupon.findAll({ where: { id: couponIds, type: 'CASHBACK' }, attributes: ['id', 'code'], paranoid: false })
      : [],
    offerIds.length ? CashbackOffer.findAll({ where: { id: offerIds }, attributes: ['id', 'name'], paranoid: false }) : [],
  ]);
  const codeById = new Map(coupons.map((coupon) => [coupon.id, coupon.code]));
  const offerById = new Map(offers.map((offer) => [offer.id, offer.name]));

  const items = orders.map((order) =>
    cashbackEntryFor(
      order,
      (order.appliedCouponIds ?? []).flatMap((id) => codeById.get(id) ?? []),
      order.cashbackOfferId ? (offerById.get(order.cashbackOfferId) ?? null) : null,
    ),
  );
  return { items, totals: sums, pagination: buildPaginationMeta(count, query.page, query.limit) };
}
