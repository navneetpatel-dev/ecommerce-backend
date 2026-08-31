import { Op } from 'sequelize';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { DISCOUNT_BEARER, COMMISSION_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { fromPaise } from '@modules/pricing/money';
import { paginationOffset, buildPaginationMeta } from '@core/http/pagination';
import { DEFAULT_PAGE_LIMIT } from '@core/constants/http';
import type { ReportRangeQuery, WriteOffReportQuery } from './reports.dto';
import { getReportDefinition } from './engine/reportRegistry';
import {
  inclusiveReportTo,
  frozenPaise,
  computeReconciliationSummary,
  assertReportRange,
  sqlFrozenPaise,
} from './engine/queryHelpers';
import { renderReportTablePdf } from '@core/pdf';
import { resolveReportColumnLabel } from './reports.constants';

function assertRange(query: ReportRangeQuery) {
  assertReportRange({ from: query.from, to: query.to });
}

function engineRange(query: ReportRangeQuery) {
  return {
    from: query.from,
    to: inclusiveReportTo(query.to),
  };
}

export class ReportsService {
  /**
   * Dashboard summary metrics — same SQL identity as engine reconciliation (no load-all).
   */
  async adminSummary(query: ReportRangeQuery) {
    assertRange(query);
    const range = engineRange(query);
    const summary = await computeReconciliationSummary(range);
    return {
      from: range.from,
      to: range.to,
      gmv: fromPaise(summary.gmvPaise),
      customerPayments: fromPaise(summary.customerPaymentsPaise),
      commissionEarned: fromPaise(summary.platformCommissionPaise),
      taxCollected: fromPaise(summary.taxCollectedPaise),
      tcsCollected: fromPaise(summary.tcsCollectedPaise),
      shippingCollected: fromPaise(summary.shippingCollectedPaise),
      discountAbsorbed: {
        platform: fromPaise(summary.platformDiscountPaise),
        vendor: fromPaise(summary.vendorDiscountPaise),
        merchandiseTotal: fromPaise(summary.merchandiseDiscountPaise),
      },
      vendorNetPayouts: fromPaise(summary.vendorNetPayoutsPaise),
    };
  }

  /** Paginated vendor settlement rows for the finance panel (full export via async engine). */
  async adminVendorSettlements(query: ReportRangeQuery) {
    assertRange(query);
    const range = engineRange(query);
    const def = getReportDefinition('vendor-settlement');
    if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const result = await def.query({ ...range, page, limit });
    return {
      from: range.from,
      to: range.to,
      vendors: result.rows.map((row) => ({
        vendorId: String(row.vendorId ?? ''),
        vendorName: String(row.vendorName ?? ''),
        pendingNet: Number(row.pendingNet ?? 0),
        settledNet: Number(row.settledNet ?? 0),
        payoutAmount: Number(row.payoutAmount ?? 0),
        payoutPending: Number(row.payoutPending ?? 0),
        payoutPaid: Number(row.payoutPaid ?? 0),
        payoutStatus: String(row.payoutStatus ?? ''),
      })),
      pagination: buildPaginationMeta(result.total, page, limit),
    };
  }

  /** Delegates to engine `reconciliation` (includes refunds-to-customer). */
  async adminReconciliation(query: ReportRangeQuery) {
    assertRange(query);
    const range = engineRange(query);
    const def = getReportDefinition('reconciliation');
    if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);
    const result = await def.query({ ...range, page: 1, limit: 1 });
    const row = (result.meta ?? result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      from: range.from,
      to: range.to,
      customerPayments: Number(row.customerPayments ?? 0),
      vendorNetPayouts: Number(row.vendorNetPayouts ?? 0),
      platformCommission: Number(row.platformCommission ?? 0),
      taxCollected: Number(row.taxCollected ?? 0),
      tcsCollected: Number(row.tcsCollected ?? 0),
      shippingCollected: Number(row.shippingCollected ?? 0),
      refundsToCustomer: Number(row.refundsToCustomer ?? 0),
      accountedTotal: Number(row.accountedTotal ?? 0),
      difference: Number(row.difference ?? 0),
      balanced: Boolean(row.balanced ?? row.status === 'BALANCED'),
      status: String(row.status ?? 'MISMATCH'),
      error: row.error ?? (row.status === 'BALANCED' ? null : ERROR_MESSAGES.REPORT_RECONCILIATION_MISMATCH),
    };
  }

  async vendorSummary(vendorId: string, query: ReportRangeQuery, requesterVendorId?: string | null) {
    if (requesterVendorId && requesterVendorId !== vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
    }
    assertRange(query);
    const range = engineRange(query);

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
      { replacements: { vendorId, from: range.from, to: range.to } },
    );
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};

    return {
      from: range.from,
      to: range.to,
      vendorId,
      sales: fromPaise(Number(row.salesPaise ?? 0)),
      commissionDeducted: fromPaise(Number(row.commissionPaise ?? 0)),
      tcsDeducted: fromPaise(Number(row.tcsPaise ?? 0)),
      discountAbsorbed: {
        ownCoupons: fromPaise(Number(row.vendorDiscountPaise ?? 0)),
        platformCouponsOnMyItems: fromPaise(Number(row.platformDiscountPaise ?? 0)),
      },
      netPayout: fromPaise(Number(row.netPaise ?? 0)),
      upcomingPayout: fromPaise(Number(row.pendingPaise ?? 0)),
      historicalPayout: fromPaise(Number(row.settledPaise ?? 0)),
    };
  }

  /**
   * Outstanding customer wallet balances as of :to for users with ledger activity in range.
   */
  async walletLiabilityReport(
    query: ReportRangeQuery & { page?: number; limit?: number },
  ): Promise<{
    totalLiability: number;
    customerCount: number;
    rows: Array<{ userId: string; balance: number; asOf: Date }>;
    pagination: ReturnType<typeof buildPaginationMeta>;
  }> {
    assertRange(query);
    const range = engineRange(query);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT);
    const offset = paginationOffset(page, limit);
    const replacements = { from: range.from, to: range.to, limit, offset };

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
      { replacements: { from: range.from, to: range.to } },
    )) as [Array<{ customerCount: number; totalLiability: number }>, unknown];

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
       FROM latest
       WHERE balance > 0
       ORDER BY balance DESC
       LIMIT :limit OFFSET :offset`,
      { replacements },
    )) as [Array<{ userId: string; balance: number; asOf: Date }>, unknown];

    const customerCount = Number(totals?.customerCount ?? 0);
    return {
      totalLiability: Math.round(Number(totals?.totalLiability ?? 0) * 100) / 100,
      customerCount,
      rows: rows.map((r) => ({
        userId: r.userId,
        balance: Number(r.balance),
        asOf: r.asOf,
      })),
      pagination: buildPaginationMeta(customerCount, page, limit),
    };
  }

  /** Cashback write-offs with SQL pagination; totals from a separate aggregate query. */
  async cashbackWriteOffReport(
    query: WriteOffReportQuery & { page?: number; limit?: number },
  ): Promise<{
    from: Date;
    to: Date;
    bornBy: string | null;
    recoveredTotal: number;
    writtenOffTotal: number;
    rows: Array<{
      id: string;
      userId: string;
      originalClawbackAmount: number;
      recoveredAmount: number;
      writtenOffAmount: number;
      bornBy: string;
      referenceType: string;
      referenceId: string;
      createdAt: Date;
    }>;
    pagination: ReturnType<typeof buildPaginationMeta>;
  }> {
    assertRange(query);
    const from = query.from;
    const to = inclusiveReportTo(query.to);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT);
    const offset = paginationOffset(page, limit);

    const where: Record<string, unknown> = {
      createdAt: { [Op.between]: [from, to] },
    };
    if (query.bornBy) where.bornBy = query.bornBy;

    const [totalsRaw, pageResult] = await Promise.all([
      WalletWriteOff.findAll({
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
      }),
      WalletWriteOff.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      }),
    ]);

    const aggregate = (totalsRaw[0] ?? {
      recoveredTotal: 0,
      writtenOffTotal: 0,
    }) as { recoveredTotal: string | number; writtenOffTotal: string | number };

    return {
      from,
      to,
      bornBy: query.bornBy ?? null,
      recoveredTotal: Math.round(Number(aggregate.recoveredTotal) * 100) / 100,
      writtenOffTotal: Math.round(Number(aggregate.writtenOffTotal) * 100) / 100,
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
      pagination: buildPaginationMeta(pageResult.count, page, limit),
    };
  }

  toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (value: unknown) => {
      const raw = value == null ? '' : String(value);
      if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  }

  async toPdf(title: string, rows: Record<string, unknown>[]): Promise<Buffer> {
    const columns =
      rows.length > 0
        ? Object.keys(rows[0]!).map((key) => ({
            key,
            label: resolveReportColumnLabel(key),
          }))
        : [];

    return renderReportTablePdf({
      title,
      columns,
      rows,
      emptyMessage: 'No rows',
    });
  }
}

export const reportsService = new ReportsService();
