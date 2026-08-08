import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ORDER_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  pagedFindAndCount,
  pagedSqlQuery,
  dateBetween,
} from '../engine/queryHelpers';

function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100;
}

async function orderSla(filters: ReportFilters) {
  assertReportRange(filters);
  const where: Record<string, unknown> = {
    status: ORDER_STATUS.DELIVERED,
    updatedAt: dateBetween(filters.from, filters.to),
  };
  const vendorId = resolveVendorId(filters);
  if (vendorId) where.vendorId = vendorId;

  const { rows, total } = await pagedFindAndCount(
    SubOrder,
    {
      where,
      include: [
        { model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false },
        { model: Order, as: 'order', attributes: ['id'], required: false },
      ],
      order: [['updatedAt', 'DESC']],
    },
    filters,
  );

  const detail = rows.map((sub) => {
    const vendor = (sub as SubOrder & { vendor?: Vendor }).vendor;
    const vid = sub.vendorId ?? 'UNKNOWN';
    return {
      vendorId: vid,
      vendorName: vendor?.businessName ?? vid,
      subOrderId: sub.id,
      orderId: sub.orderId,
      createdAt: sub.createdAt,
      deliveredAt: sub.updatedAt,
      hoursToDeliver: hoursBetween(sub.createdAt as Date, sub.updatedAt as Date),
    };
  });

  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  const vendorClause = vendorId ? 'AND so."vendorId" = :vendorId' : '';
  if (vendorId) replacements.vendorId = vendorId;

  const [metaRows] = await sequelize.query(
    `
    SELECT
      COALESCE(so."vendorId"::text, 'UNKNOWN') AS "vendorId",
      COALESCE(MAX(v."businessName"), COALESCE(so."vendorId"::text, 'UNKNOWN')) AS "vendorName",
      COUNT(*)::int AS "deliveredCount",
      ROUND(
        (AVG(EXTRACT(EPOCH FROM (so."updatedAt" - so."createdAt")) / 3600.0))::numeric,
        2
      ) AS "avgHoursToDeliver"
    FROM sub_orders so
    LEFT JOIN vendors v
      ON v.id = so."vendorId"
      AND v."deletedAt" IS NULL
    WHERE so.status = '${ORDER_STATUS.DELIVERED}'
      AND so."updatedAt" BETWEEN :from AND :to
      AND so."deletedAt" IS NULL
      ${vendorClause}
    GROUP BY so."vendorId"
    `,
    { replacements },
  );

  return {
    rows: detail,
    total,
    meta: {
      byVendor: (metaRows as Array<Record<string, unknown>>).map((r) => ({
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        deliveredCount: Number(r.deliveredCount ?? 0),
        avgHoursToDeliver: Number(r.avgHoursToDeliver ?? 0),
      })),
    },
  };
}

async function cancellations(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);

  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  if (vendorId) replacements.vendorId = vendorId;

  const orderSelect = `
    SELECT
      'ORDER'::text AS level,
      o.id AS "orderId",
      NULL::uuid AS "subOrderId",
      NULL::uuid AS "vendorId",
      NULL::text AS "vendorName",
      o."userId" AS "userId",
      o.status::text AS status,
      COALESCE(o."totalAmount", 0)::float AS amount,
      COALESCE(o."updatedAt", o."createdAt") AS "cancelledAt"
    FROM orders o
    WHERE o.status = '${ORDER_STATUS.CANCELLED}'
      AND COALESCE(o."updatedAt", o."createdAt") BETWEEN :from AND :to
      AND o."deletedAt" IS NULL
  `;

  const subSelect = `
    SELECT
      'SUB_ORDER'::text AS level,
      so."orderId" AS "orderId",
      so.id AS "subOrderId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      o."userId" AS "userId",
      so.status::text AS status,
      COALESCE(so.subtotal, 0)::float AS amount,
      COALESCE(so."updatedAt", so."createdAt") AS "cancelledAt"
    FROM sub_orders so
    LEFT JOIN vendors v
      ON v.id = so."vendorId"
      AND v."deletedAt" IS NULL
    LEFT JOIN orders o
      ON o.id = so."orderId"
      AND o."deletedAt" IS NULL
    WHERE so.status = '${ORDER_STATUS.CANCELLED}'
      AND COALESCE(so."updatedAt", so."createdAt") BETWEEN :from AND :to
      AND so."deletedAt" IS NULL
      ${vendorId ? 'AND so."vendorId" = :vendorId' : ''}
  `;

  // When vendor-scoped, only cancelled sub-orders apply (order-level has no vendor).
  const selectSql = vendorId ? subSelect : `${orderSelect} UNION ALL ${subSelect}`;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"cancelledAt" DESC`,
    replacements,
    filters,
    mapRow: (row) => ({
      level: row.level,
      orderId: row.orderId,
      subOrderId: row.subOrderId,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      userId: row.userId,
      status: row.status,
      amount: Number(row.amount ?? 0),
      cancelledAt: row.cancelledAt,
    }),
  });
}

async function refundReturn(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const where: Record<string, unknown> = {
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    ReturnRequest,
    {
      where,
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          required: !!vendorId,
          where: vendorId ? { vendorId } : undefined,
          attributes: ['id', 'vendorId', 'orderId'],
        },
      ],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((r) => {
      const created = r.createdAt as Date;
      const resolved = r.resolvedAt;
      const turnaroundHours =
        resolved != null ? hoursBetween(created, resolved as Date) : null;
      return {
        id: r.id,
        subOrderId: r.subOrderId,
        orderItemId: r.orderItemId,
        reasonCode: r.reasonCode,
        status: r.status,
        refundStatus: r.refundStatus,
        refundAmount: Number(r.refundAmount ?? 0),
        turnaroundHours,
        createdAt: created,
        resolvedAt: resolved,
      };
    }),
    total,
  };
}

export const adminOpsReports: ReportDefinition[] = [
  {
    type: 'order-sla',
    labelKey: 'reportOrderSla',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'deliveredAt', labelKey: 'deliveredAt', format: 'date' },
      { key: 'hoursToDeliver', labelKey: 'hoursToDeliver', format: 'number' },
    ],
    query: orderSla,
  },
  {
    type: 'cancellations',
    labelKey: 'reportCancellations',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'level', labelKey: 'level' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'status', labelKey: 'status' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
      { key: 'cancelledAt', labelKey: 'cancelledAt', format: 'date' },
    ],
    query: cancellations,
  },
  {
    type: 'refund-return',
    labelKey: 'reportRefundReturn',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'id', labelKey: 'id' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderItemId', labelKey: 'orderItemId' },
      { key: 'reasonCode', labelKey: 'reasonCode' },
      { key: 'status', labelKey: 'status' },
      { key: 'refundStatus', labelKey: 'refundStatus' },
      { key: 'refundAmount', labelKey: 'refundAmount', format: 'currency' },
      { key: 'turnaroundHours', labelKey: 'turnaroundHours', format: 'number' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'resolvedAt', labelKey: 'resolvedAt', format: 'date' },
    ],
    query: refundReturn,
  },
];
