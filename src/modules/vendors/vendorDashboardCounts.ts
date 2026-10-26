import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';
import { istStartOfDay } from '@modules/pricing/istCalendar';
import { VENDOR_VISIBLE_ORDER_SQL } from '@modules/suborders/subOrderTransitions';

/**
 * The vendor dashboard's order counts: today's orders and parts still to ship. Like the
 * vendor's order list, they leave out online orders still awaiting payment.
 */
export async function vendorDashboardOrderCounts(vendorId: string) {
  const [today] = await sequelize.query<{ orders: string }>(
    `SELECT COUNT(*)::int AS orders
     FROM sub_orders s
     INNER JOIN orders o ON o.id = s."orderId"
     WHERE s."vendorId" = :vendorId
       AND s.status <> :cancelled
       AND s."createdAt" >= :dayStart
       AND ${VENDOR_VISIBLE_ORDER_SQL}`,
    {
      // Today in India time (midnight IST), not UTC.
      replacements: { vendorId, cancelled: ORDER_STATUS.CANCELLED, dayStart: istStartOfDay(new Date()) },
      type: QueryTypes.SELECT,
    },
  );
  const [pending] = await sequelize.query<{ shipments: string }>(
    `SELECT COUNT(*)::int AS shipments
     FROM sub_orders s
     INNER JOIN orders o ON o.id = s."orderId"
     WHERE s."vendorId" = :vendorId
       AND s.status IN (:pending, :confirmed)
       AND ${VENDOR_VISIBLE_ORDER_SQL}`,
    {
      replacements: { vendorId, pending: ORDER_STATUS.PENDING, confirmed: ORDER_STATUS.CONFIRMED },
      type: QueryTypes.SELECT,
    },
  );
  return { today, pending };
}
