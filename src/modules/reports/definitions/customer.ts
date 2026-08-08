import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  pagedFindAndCount,
  emptyPage,
  dateBetween,
} from '../engine/queryHelpers';

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
      include: [
        {
          model: SubOrder,
          as: 'subOrders',
          attributes: ['id'],
        },
      ],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((order) => {
      const subs = (order as Order & { subOrders?: SubOrder[] }).subOrders ?? [];
      return {
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: Number(order.totalAmount ?? 0),
        discountTotal: Number(order.discountTotal ?? 0),
        subOrderCount: subs.length,
        createdAt: order.createdAt,
      };
    }),
    total,
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
      { key: 'discountTotal', labelKey: 'discountTotal', format: 'currency' },
      { key: 'subOrderCount', labelKey: 'subOrderCount', format: 'number' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: customerOrderHistory,
  },
];
