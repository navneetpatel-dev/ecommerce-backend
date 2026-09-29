import { Op } from 'sequelize';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { mapOrderResponse } from '@modules/orders/orderDisplayMappers';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  pagedFindAndCount,
  emptyPage,
  dateBetween,
} from '../engine/queryHelpers';

// The parts and their lines, so the savings are worked out as the order page shows them.
const ORDER_PARTS_INCLUDE = [
  {
    model: SubOrder,
    as: 'subOrders',
    include: [{ model: OrderItem, as: 'items' }],
  },
];

function mapOrderHistoryRow(order: Order) {
  const subs = (order as Order & { subOrders?: SubOrder[] }).subOrders ?? [];
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: Number(order.totalAmount ?? 0),
    // What coupons saved, GST included — as on the order page (null for orders placed
    // before lines recorded their GST).
    couponSavings: mapOrderResponse(order as unknown as Record<string, unknown>).couponSavings,
    subOrderCount: subs.length,
    createdAt: order.createdAt,
  };
}

async function customerOrderHistory(filters: ReportFilters) {
  assertReportRange(filters);
  if (!filters.userId) {
    return emptyPage(filters);
  }

  const where: Record<string, unknown> = {
    userId: filters.userId,
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    Order,
    {
      where,
      include: ORDER_PARTS_INCLUDE,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map(mapOrderHistoryRow),
    total,
  };
}

async function customerOrderHistoryExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  if (!filters.userId) return { rows: [], nextCursor: null };

  const where: Record<string | symbol, unknown> = {
    userId: filters.userId,
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;
  if (cursor && cursor.values.length >= 2) {
    const createdAt = cursor.values[0];
    const id = cursor.values[1];
    where[Op.or] = [
      { createdAt: { [Op.lt]: createdAt } },
      { createdAt, id: { [Op.lt]: id } },
    ];
  }

  const rows = await Order.findAll({
    where: where as never,
    include: ORDER_PARTS_INCLUDE,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  return {
    rows: rows.map(mapOrderHistoryRow),
    nextCursor:
      rows.length < limit || !rows[rows.length - 1]
        ? null
        : {
            values: [rows[rows.length - 1]!.createdAt, rows[rows.length - 1]!.id],
          },
  };
}

export const customerReports: ReportDefinition[] = [
  {
    type: 'customer-order-history',
    labelKey: 'reportCustomerOrderHistory',
    audience: 'customer',
    permissions: [],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'status', labelKey: 'status' },
      { key: 'paymentStatus', labelKey: 'paymentStatus' },
      { key: 'totalAmount', labelKey: 'totalAmount', format: 'currency' },
      { key: 'couponSavings', labelKey: 'couponSavings', format: 'currency' },
      { key: 'subOrderCount', labelKey: 'subOrderCount', format: 'number' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: customerOrderHistory,
    exportQuery: customerOrderHistoryExport,
  },
];
