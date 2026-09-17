import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ORDER_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { createOffsetExportQuery } from '../engine/export/createOffsetExportQuery';
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

/**
 * Live operational snapshot, not a date-ranged history — this query
 * deliberately ignores `filters.from`/`filters.to` and checks fixed
 * staleness thresholds instead ("what's stuck right now" isn't a lookback
 * window). Note: `ReportEngine.runJson` still enforces `assertReportRange`
 * on every report type before dispatch, so the UI's date picker must be
 * given some valid (non-too-wide) range to pass that check — it just has
 * no effect on which rows come back here. Left as-is rather than special-
 * casing the shared engine for one report; not worth the regression risk.
 */
const STUCK_AWAITING_SHIPMENT_HOURS = 48;
const STUCK_IN_TRANSIT_HOURS = 72;
const STUCK_OUT_FOR_DELIVERY_HOURS = 24;
const STUCK_PICKUP_OVERDUE_HOURS = 48;

async function stuckOrders(filters: ReportFilters) {
  const vendorId = resolveVendorId(filters);
  const vendorClauseSub = vendorId ? 'AND so."vendorId" = :vendorId' : '';
  const replacements: Record<string, unknown> = {
    awaitingShipmentHours: STUCK_AWAITING_SHIPMENT_HOURS,
    inTransitHours: STUCK_IN_TRANSIT_HOURS,
    outForDeliveryHours: STUCK_OUT_FOR_DELIVERY_HOURS,
    pickupOverdueHours: STUCK_PICKUP_OVERDUE_HOURS,
  };
  if (vendorId) replacements.vendorId = vendorId;

  const awaitingShipmentSelect = `
    SELECT
      'AWAITING_SHIPMENT'::text AS reason,
      so."orderId" AS "orderId",
      so.id AS "subOrderId",
      NULL::uuid AS "returnId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      so.status::text AS status,
      so."updatedAt" AS "stuckSince",
      ROUND(EXTRACT(EPOCH FROM (now() - so."updatedAt")) / 3600.0)::int AS "hoursStuck"
    FROM sub_orders so
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE so.status = '${ORDER_STATUS.CONFIRMED}'
      AND so."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh."subOrderId" = so.id)
      AND so."updatedAt" < now() - (:awaitingShipmentHours || ' hours')::interval
      ${vendorClauseSub}
  `;

  const inTransitSelect = `
    SELECT
      'IN_TRANSIT_TOO_LONG'::text AS reason,
      so."orderId" AS "orderId",
      so.id AS "subOrderId",
      NULL::uuid AS "returnId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      sh.status::text AS status,
      sh."updatedAt" AS "stuckSince",
      ROUND(EXTRACT(EPOCH FROM (now() - sh."updatedAt")) / 3600.0)::int AS "hoursStuck"
    FROM shipments sh
    JOIN sub_orders so ON so.id = sh."subOrderId" AND so."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE sh.status IN ('PICKED_UP', 'IN_TRANSIT')
      AND sh."updatedAt" < now() - (:inTransitHours || ' hours')::interval
      ${vendorClauseSub}
  `;

  const outForDeliverySelect = `
    SELECT
      'DELIVERY_NOT_CONFIRMED'::text AS reason,
      so."orderId" AS "orderId",
      so.id AS "subOrderId",
      NULL::uuid AS "returnId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      sh.status::text AS status,
      sh."updatedAt" AS "stuckSince",
      ROUND(EXTRACT(EPOCH FROM (now() - sh."updatedAt")) / 3600.0)::int AS "hoursStuck"
    FROM shipments sh
    JOIN sub_orders so ON so.id = sh."subOrderId" AND so."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE sh.status = 'OUT_FOR_DELIVERY'
      AND sh."updatedAt" < now() - (:outForDeliveryHours || ' hours')::interval
      ${vendorClauseSub}
  `;

  const pickupOverdueSelect = `
    SELECT
      'PICKUP_OVERDUE'::text AS reason,
      so."orderId" AS "orderId",
      rr."subOrderId" AS "subOrderId",
      rr.id AS "returnId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      rr.status::text AS status,
      rr."updatedAt" AS "stuckSince",
      ROUND(EXTRACT(EPOCH FROM (now() - rr."updatedAt")) / 3600.0)::int AS "hoursStuck"
    FROM return_requests rr
    JOIN sub_orders so ON so.id = rr."subOrderId" AND so."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE rr.status = 'PICKUP_SCHEDULED'
      AND rr."updatedAt" < now() - (:pickupOverdueHours || ' hours')::interval
      ${vendorClauseSub}
  `;

  const selectSql = [
    awaitingShipmentSelect,
    inTransitSelect,
    outForDeliverySelect,
    pickupOverdueSelect,
  ].join(' UNION ALL ');

  return pagedSqlQuery({
    selectSql,
    orderBySql: '"hoursStuck" DESC',
    replacements,
    filters,
    mapRow: (row) => ({
      reason: row.reason,
      orderId: row.orderId,
      subOrderId: row.subOrderId,
      returnId: row.returnId,
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? row.vendorId,
      status: row.status,
      stuckSince: row.stuckSince,
      hoursStuck: Number(row.hoursStuck ?? 0),
    }),
  });
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
    exportQuery: createOffsetExportQuery(orderSla),
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
    exportQuery: createOffsetExportQuery(cancellations),
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
    exportQuery: createOffsetExportQuery(refundReturn),
  },
  {
    type: 'stuck-orders',
    labelKey: 'reportStuckOrders',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'reason', labelKey: 'reason' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'returnId', labelKey: 'returnId' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'status', labelKey: 'status' },
      { key: 'stuckSince', labelKey: 'stuckSince', format: 'date' },
      { key: 'hoursStuck', labelKey: 'hoursStuck', format: 'number' },
    ],
    query: stuckOrders,
    exportQuery: createOffsetExportQuery(stuckOrders),
  },
];