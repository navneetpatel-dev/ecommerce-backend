import { Op, QueryTypes } from 'sequelize';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { sequelize } from '@database/models';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { paginationOffset } from '@core/http/pagination';
import { DEFAULT_PAGE_LIMIT } from '@core/constants/http';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { createOffsetExportQuery, createSingleShotExportQuery } from '../engine/export/createOffsetExportQuery';
import {
  assertReportRange,
  inclusiveReportTo,
  pagedFindAndCount,
  emptyPage,
  computeReconciliationSummary,
  fromPaise,
  sqlFrozenPaise,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
} from '../engine/queryHelpers';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';

const WALLET_LIABILITY_KEYSET: KeysetOrderCol[] = [
  { column: 'balance', direction: 'DESC' },
  { column: 'userId', direction: 'ASC' },
];

function walletLiabilitySelectSql(): string {
  return `
    WITH active_users AS (
      SELECT DISTINCT "userId"
      FROM wallet_ledgers
      WHERE "deletedAt" IS NULL
        AND "createdAt" BETWEEN :from AND :to
    ),
    latest AS (
      SELECT DISTINCT ON (wl."userId")
        wl."userId" AS "userId",
        wl."balanceAfter" AS balance,
        wl."createdAt" AS "asOf"
      FROM wallet_ledgers wl
      INNER JOIN active_users au ON au."userId" = wl."userId"
      WHERE wl."deletedAt" IS NULL
        AND wl."createdAt" <= :to
      ORDER BY wl."userId", wl."createdAt" DESC
    )
    SELECT "userId", balance, "asOf"
    FROM latest WHERE balance > 0
  `;
}

export async function walletLiabilityTotals(filters: {
  from: Date;
  to: Date;
}): Promise<{ customerCount: number; totalLiability: number }> {
  const [[totals]] = (await sequelize.query(
    `WITH active_users AS (
       SELECT DISTINCT "userId"
       FROM wallet_ledgers
       WHERE "deletedAt" IS NULL
         AND "createdAt" BETWEEN :from AND :to
     ),
     latest AS (
       SELECT DISTINCT ON (wl."userId")
         wl."userId",
         wl."balanceAfter"
       FROM wallet_ledgers wl
       INNER JOIN active_users au ON au."userId" = wl."userId"
       WHERE wl."deletedAt" IS NULL
         AND wl."createdAt" <= :to
       ORDER BY wl."userId", wl."createdAt" DESC
     )
     SELECT
       COUNT(*)::int AS "customerCount",
       COALESCE(SUM("balanceAfter"), 0)::float AS "totalLiability"
     FROM latest
     WHERE "balanceAfter" > 0`,
    { replacements: { from: filters.from, to: filters.to } },
  )) as [Array<{ customerCount: number; totalLiability: number }>, unknown];
  return {
    customerCount: Number(totals?.customerCount ?? 0),
    totalLiability: Number(totals?.totalLiability ?? 0),
  };
}

async function walletLiabilityExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: walletLiabilitySelectSql(),
    order: WALLET_LIABILITY_KEYSET,
    replacements: { from: filters.from, to: filters.to },
    limit,
    cursor,
    mapRow: (row) => ({
      userId: String(row.userId ?? ''),
      balance: Number(row.balance ?? 0),
      asOf: row.asOf as Date,
    }),
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function walletLiabilityQuery(filters: ReportFilters) {
  assertReportRange(filters);
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, filters.limit ?? DEFAULT_PAGE_LIMIT);
  const offset = paginationOffset(page, limit);
  const skipCount = filters._exportSkipCount === true;
  const knownTotal = filters._exportKnownTotal;
  const replacements = { from: filters.from, to: filters.to, limit, offset };

  let customerCount = knownTotal ?? 0;
  if (!skipCount) {
    const [[totals]] = (await sequelize.query(
      `WITH active_users AS (
         SELECT DISTINCT "userId"
         FROM wallet_ledgers
         WHERE "deletedAt" IS NULL
           AND "createdAt" BETWEEN :from AND :to
       ),
       latest AS (
         SELECT DISTINCT ON (wl."userId")
           wl."userId",
           wl."balanceAfter"
         FROM wallet_ledgers wl
         INNER JOIN active_users au ON au."userId" = wl."userId"
         WHERE wl."deletedAt" IS NULL
           AND wl."createdAt" <= :to
         ORDER BY wl."userId", wl."createdAt" DESC
       )
       SELECT COUNT(*)::int AS "customerCount"
       FROM latest WHERE "balanceAfter" > 0`,
      { replacements: { from: filters.from, to: filters.to } },
    )) as [Array<{ customerCount: number }>, unknown];
    customerCount = Number(totals?.customerCount ?? 0);
  }

  if (customerCount === 0) return emptyPage(filters);

  const [rows] = (await sequelize.query(
    `WITH active_users AS (
       SELECT DISTINCT "userId"
       FROM wallet_ledgers
       WHERE "deletedAt" IS NULL
         AND "createdAt" BETWEEN :from AND :to
     ),
     latest AS (
       SELECT DISTINCT ON (wl."userId")
         wl."userId" AS "userId",
         wl."balanceAfter" AS balance,
         wl."createdAt" AS "asOf"
       FROM wallet_ledgers wl
       INNER JOIN active_users au ON au."userId" = wl."userId"
       WHERE wl."deletedAt" IS NULL
         AND wl."createdAt" <= :to
       ORDER BY wl."userId", wl."createdAt" DESC
     )
     SELECT "userId", balance, "asOf"
     FROM latest WHERE balance > 0
     ORDER BY balance DESC
     LIMIT :limit OFFSET :offset`,
    { replacements },
  )) as [Array<{ userId: string; balance: number; asOf: Date }>, unknown];

  return {
    rows: rows.map((r) => ({
      userId: r.userId,
      balance: Number(r.balance),
      asOf: r.asOf,
    })),
    total: customerCount,
  };
}

async function cashbackWriteOffQuery(filters: ReportFilters) {
  assertReportRange(filters);
  const from = filters.from;
  const to = inclusiveReportTo(filters.to);
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, filters.limit ?? DEFAULT_PAGE_LIMIT);
  const where: Record<string, unknown> = {
    createdAt: { [Op.between]: [from, to] },
  };
  if (filters.bornBy) where.bornBy = filters.bornBy;

  const findOpts = {
    where,
    order: [['createdAt', 'DESC']] as [string, string][],
    limit,
    offset: paginationOffset(page, limit),
  };
  if (filters._exportSkipCount && filters._exportKnownTotal != null) {
    const rows = await WalletWriteOff.findAll(findOpts);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        originalClawbackAmount: Number(row.originalClawbackAmount),
        recoveredAmount: Number(row.recoveredAmount),
        writtenOffAmount: Number(row.writtenOffAmount),
        bornBy: row.bornBy,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdAt: row.createdAt as Date,
      })),
      total: filters._exportKnownTotal,
      meta: {
        recoveredTotal: null,
        writtenOffTotal: null,
        bornBy: filters.bornBy ?? null,
      },
    };
  }

  const pageResult = await WalletWriteOff.findAndCountAll(findOpts);
  const totalsRaw = await WalletWriteOff.findAll({
    where,
    attributes: [
      [
        sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('recoveredAmount')), 0),
        'recoveredTotal',
      ],
      [
        sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('writtenOffAmount')), 0),
        'writtenOffTotal',
      ],
    ],
    raw: true,
  });
  const aggregate = (totalsRaw[0] ?? {
    recoveredTotal: 0,
    writtenOffTotal: 0,
  }) as { recoveredTotal: string | number; writtenOffTotal: string | number };

  return {
    rows: pageResult.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      originalClawbackAmount: Number(row.originalClawbackAmount),
      recoveredAmount: Number(row.recoveredAmount),
      writtenOffAmount: Number(row.writtenOffAmount),
      bornBy: row.bornBy,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: row.createdAt as Date,
    })),
    total: pageResult.count,
    meta: {
      recoveredTotal: Math.round(Number(aggregate.recoveredTotal) * 100) / 100,
      writtenOffTotal: Math.round(Number(aggregate.writtenOffTotal) * 100) / 100,
      bornBy: filters.bornBy ?? null,
    },
  };
}

const CASHBACK_WRITE_OFF_KEYSET: KeysetOrderCol[] = [
  { column: 'createdAt', direction: 'DESC' },
  { column: 'id', direction: 'DESC' },
];

function cashbackWriteOffSelectSql(): string {
  return `
    SELECT
      w.id AS id,
      w."userId" AS "userId",
      w."originalClawbackAmount" AS "originalClawbackAmount",
      w."recoveredAmount" AS "recoveredAmount",
      w."writtenOffAmount" AS "writtenOffAmount",
      w."bornBy" AS "bornBy",
      w."referenceType" AS "referenceType",
      w."referenceId" AS "referenceId",
      w."createdAt" AS "createdAt"
    FROM wallet_write_offs w
    WHERE w."deletedAt" IS NULL
      AND w."createdAt" BETWEEN :from AND :to
      AND (:bornBy::text IS NULL OR w."bornBy" = :bornBy)
  `;
}

function mapCashbackWriteOffRow(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    userId: String(row.userId ?? ''),
    originalClawbackAmount: Number(row.originalClawbackAmount ?? 0),
    recoveredAmount: Number(row.recoveredAmount ?? 0),
    writtenOffAmount: Number(row.writtenOffAmount ?? 0),
    bornBy: String(row.bornBy ?? ''),
    referenceType: String(row.referenceType ?? ''),
    referenceId: String(row.referenceId ?? ''),
    createdAt: row.createdAt as Date,
  };
}

async function cashbackWriteOffExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const from = filters.from;
  const to = inclusiveReportTo(filters.to);
  const page = await keysetSqlQuery({
    selectSql: cashbackWriteOffSelectSql(),
    order: CASHBACK_WRITE_OFF_KEYSET,
    replacements: {
      from,
      to,
      bornBy: filters.bornBy ?? null,
    },
    limit,
    cursor,
    mapRow: mapCashbackWriteOffRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function platformAnalyticsQuery(filters: ReportFilters) {
  assertReportRange(filters);
  const [rangeStats] = await sequelize.query<{
    gmv: string;
    paidGmv: string;
    orderCount: string;
    customerCount: string;
    cancelledCount: string;
    returnCount: string;
  }>(
    `
    SELECT
      COALESCE(SUM(o."totalAmount"), 0)::numeric AS gmv,
      COALESCE(SUM(o."totalAmount") FILTER (WHERE o."paymentStatus" = 'PAID'), 0)::numeric AS "paidGmv",
      COUNT(*)::int AS "orderCount",
      COUNT(DISTINCT o."userId")::int AS "customerCount",
      COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS "cancelledCount",
      0::int AS "returnCount"
    FROM orders o
    WHERE o."createdAt" BETWEEN :from AND :to
      AND o."deletedAt" IS NULL
    `,
    {
      replacements: { from: filters.from, to: filters.to },
      type: QueryTypes.SELECT,
    },
  );
  const stats = rangeStats ?? {
    gmv: '0',
    paidGmv: '0',
    orderCount: '0',
    customerCount: '0',
    cancelledCount: '0',
    returnCount: '0',
  };
  const orderCount = Number(stats.orderCount ?? 0);
  const gmv = Number(stats.gmv ?? 0);
  const paidGmv = Number(stats.paidGmv ?? 0);
  const aov = orderCount > 0 ? Math.round((gmv / orderCount) * 100) / 100 : 0;
  const cancelRate =
    orderCount > 0
      ? Math.round((Number(stats.cancelledCount ?? 0) / orderCount) * 10_000) / 100
      : 0;

  const orderVolumeRows = await sequelize.query<{ date: string; count: string; revenue: string }>(
    `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
            COUNT(*)::int AS count,
            COALESCE(SUM("totalAmount"), 0)::numeric AS revenue
     FROM orders
     WHERE "createdAt" BETWEEN :from AND :to
       AND status <> 'CANCELLED'
       AND "deletedAt" IS NULL
     GROUP BY date_trunc('day', "createdAt")
     ORDER BY date_trunc('day', "createdAt") ASC`,
    {
      replacements: { from: filters.from, to: filters.to },
      type: QueryTypes.SELECT,
    },
  );

  const rows: Record<string, unknown>[] = [
    { metric: 'GMV (in range)', value: gmv, extra: null },
    { metric: 'Paid GMV (in range)', value: paidGmv, extra: null },
    { metric: 'AOV (in range)', value: aov, extra: null },
    { metric: 'Orders (in range)', value: orderCount, extra: null },
    { metric: 'Customers (in range)', value: Number(stats.customerCount ?? 0), extra: null },
    { metric: 'Cancellation rate % (in range)', value: cancelRate, extra: null },
    ...orderVolumeRows.map((row) => ({
      metric: `Volume ${row.date}`,
      value: Number(row.count),
      extra: Number(row.revenue),
    })),
  ];
  return { rows, total: rows.length };
}

async function adminDashboardSummaryQuery(filters: ReportFilters) {
  assertReportRange(filters);
  const summary = await computeReconciliationSummary({
    from: filters.from,
    to: filters.to,
  });
  const row = {
    gmv: fromPaise(summary.gmvPaise),
    customerPayments: fromPaise(summary.customerPaymentsPaise),
    commissionEarned: fromPaise(summary.platformCommissionPaise),
    taxCollected: fromPaise(summary.taxCollectedPaise),
    tcsCollected: fromPaise(summary.tcsCollectedPaise),
    shippingCollected: fromPaise(summary.shippingCollectedPaise),
    discountPlatform: fromPaise(summary.platformDiscountPaise),
    discountVendor: fromPaise(summary.vendorDiscountPaise),
    vendorNetPayouts: fromPaise(summary.vendorNetPayoutsPaise),
  };
  return { rows: [row], total: 1 };
}

async function vendorSummaryQuery(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = filters.scopedVendorId ?? filters.vendorId;
  if (!vendorId) return emptyPage(filters);

  const commissionExpr = sqlFrozenPaise('cl', 'commissionAmountPaise', 'commissionAmount');
  const netExpr = `CASE
    WHEN COALESCE(cl."netPayoutAmountPaise", 0) <> 0 THEN cl."netPayoutAmountPaise"
    ELSE ROUND(
      (
        CASE
          WHEN cl."netPayoutAmount" IS NOT NULL THEN cl."netPayoutAmount"::numeric
          ELSE COALESCE(cl."saleAmount", 0)::numeric - COALESCE(cl."commissionAmount", 0)::numeric
        END
      ) * 100
    )::bigint
  END`;
  const taxableExpr = sqlFrozenPaise('cl', 'taxableAmountPaise', 'taxableAmount');
  const tcsExpr = sqlFrozenPaise('cl', 'tcsAmountPaise', 'tcsAmount');
  const discountExpr = sqlFrozenPaise('cl', 'discountAmountPaise', 'discountAmount');

  const [rows] = await sequelize.query(
    `
    SELECT
      COALESCE(SUM(${taxableExpr}), 0)::bigint AS "salesPaise",
      COALESCE(SUM(${commissionExpr}), 0)::bigint AS "commissionPaise",
      COALESCE(SUM(${tcsExpr}), 0)::bigint AS "tcsPaise",
      COALESCE(SUM(${netExpr}), 0)::bigint AS "netPaise",
      COALESCE(SUM(CASE WHEN cl.status = '${COMMISSION_STATUS.PENDING}' THEN ${netExpr} ELSE 0 END), 0)::bigint AS "pendingPaise",
      COALESCE(SUM(CASE WHEN cl.status = '${COMMISSION_STATUS.SETTLED}' THEN ${netExpr} ELSE 0 END), 0)::bigint AS "settledPaise",
      COALESCE(SUM(CASE WHEN cl."discountBearer" = '${DISCOUNT_BEARER.VENDOR}' THEN ${discountExpr} ELSE 0 END), 0)::bigint AS "vendorDiscountPaise",
      COALESCE(SUM(CASE WHEN cl."discountBearer" IS DISTINCT FROM '${DISCOUNT_BEARER.VENDOR}' THEN ${discountExpr} ELSE 0 END), 0)::bigint AS "platformDiscountPaise"
    FROM commission_ledgers cl
    WHERE cl."deletedAt" IS NULL
      AND cl."vendorId" = :vendorId
      AND cl."createdAt" BETWEEN :from AND :to
      AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
    `,
    { replacements: { vendorId, from: filters.from, to: filters.to } },
  );
  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    rows: [
      {
        vendorId,
        sales: fromPaise(Number(row.salesPaise ?? 0)),
        commissionDeducted: fromPaise(Number(row.commissionPaise ?? 0)),
        tcsDeducted: fromPaise(Number(row.tcsPaise ?? 0)),
        discountOwnCoupons: fromPaise(Number(row.vendorDiscountPaise ?? 0)),
        discountPlatformCoupons: fromPaise(Number(row.platformDiscountPaise ?? 0)),
        netPayout: fromPaise(Number(row.netPaise ?? 0)),
        upcomingPayout: fromPaise(Number(row.pendingPaise ?? 0)),
        historicalPayout: fromPaise(Number(row.settledPaise ?? 0)),
      },
    ],
    total: 1,
  };
}

export const legacyPanelReports: ReportDefinition[] = [
  {
    type: 'wallet-liability',
    labelKey: 'reportWalletLiability',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'userId', labelKey: 'userId' },
      { key: 'balance', labelKey: 'balance', format: 'currency' },
      { key: 'asOf', labelKey: 'asOf', format: 'date' },
    ],
    query: walletLiabilityQuery,
    exportQuery: walletLiabilityExport,
  },
  {
    type: 'cashback-write-offs',
    labelKey: 'reportCashbackWriteOffs',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'id', labelKey: 'id' },
      { key: 'userId', labelKey: 'userId' },
      { key: 'originalClawbackAmount', labelKey: 'originalClawbackAmount', format: 'currency' },
      { key: 'recoveredAmount', labelKey: 'recoveredAmount', format: 'currency' },
      { key: 'writtenOffAmount', labelKey: 'writtenOffAmount', format: 'currency' },
      { key: 'bornBy', labelKey: 'bornBy' },
      { key: 'referenceType', labelKey: 'referenceType' },
      { key: 'referenceId', labelKey: 'referenceId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: cashbackWriteOffQuery,
    exportQuery: cashbackWriteOffExport,
  },
  {
    type: 'platform-analytics',
    labelKey: 'reportPlatformAnalytics',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'metric', labelKey: 'metric' },
      { key: 'value', labelKey: 'value' },
      { key: 'extra', labelKey: 'revenue', format: 'currency' },
    ],
    query: platformAnalyticsQuery,
    exportQuery: createSingleShotExportQuery(platformAnalyticsQuery),
  },
  {
    type: 'admin-dashboard-summary',
    labelKey: 'reportAdminSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'gmv', labelKey: 'gmv', format: 'currency' },
      { key: 'customerPayments', labelKey: 'customerPayments', format: 'currency' },
      { key: 'commissionEarned', labelKey: 'commissionEarned', format: 'currency' },
      { key: 'taxCollected', labelKey: 'taxCollected', format: 'currency' },
      { key: 'tcsCollected', labelKey: 'tcsCollected', format: 'currency' },
      { key: 'shippingCollected', labelKey: 'shippingCollected', format: 'currency' },
      { key: 'discountPlatform', labelKey: 'discountAbsorbedPlatform', format: 'currency' },
      { key: 'discountVendor', labelKey: 'discountAbsorbedVendor', format: 'currency' },
      { key: 'vendorNetPayouts', labelKey: 'vendorNetPayouts', format: 'currency' },
    ],
    query: adminDashboardSummaryQuery,
    exportQuery: createSingleShotExportQuery(adminDashboardSummaryQuery),
  },
  {
    type: 'vendor-summary',
    labelKey: 'reportVendorSummary',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW, PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'sales', labelKey: 'sales', format: 'currency' },
      { key: 'commissionDeducted', labelKey: 'commissionDeducted', format: 'currency' },
      { key: 'tcsDeducted', labelKey: 'tcsDeducted', format: 'currency' },
      { key: 'discountOwnCoupons', labelKey: 'discountOwnCoupons', format: 'currency' },
      { key: 'discountPlatformCoupons', labelKey: 'discountPlatformCoupons', format: 'currency' },
      { key: 'netPayout', labelKey: 'netPayout', format: 'currency' },
      { key: 'upcomingPayout', labelKey: 'upcomingPayout', format: 'currency' },
      { key: 'historicalPayout', labelKey: 'historicalPayout', format: 'currency' },
    ],
    query: vendorSummaryQuery,
    exportQuery: createSingleShotExportQuery(vendorSummaryQuery),
  },
];