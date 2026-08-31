import { Op } from 'sequelize';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { DISCOUNT_BEARER, COMMISSION_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { CommissionLedger } from '@database/models/commissionLedger.model';
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
} from './engine/queryHelpers';
import { renderReportTablePdf } from '@core/pdf';
import { resolveReportColumnLabel } from './reports.constants';
import { REPORT_EXPORT_PAGE_SIZE } from './engine/types';

function assertRange(query: ReportRangeQuery) {
  if (query.from > query.to) {
    throw new ValidationError(ERROR_MESSAGES.REPORT_INVALID_RANGE);
  }
}

function engineRange(query: ReportRangeQuery) {
  return {
    from: query.from,
    to: inclusiveReportTo(query.to),
  };
}

/** Fetch every page of an engine report (legacy panels expect full arrays). */
async function fetchAllEngineRows(reportType: string, filters: {
  from: Date;
  to: Date;
  vendorId?: string | null;
}) {
  const def = getReportDefinition(reportType);
  if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);
  const pageSize = REPORT_EXPORT_PAGE_SIZE;
  const first = await def.query({ ...filters, page: 1, limit: pageSize });
  if (first.total <= first.rows.length) return first;
  const rows = [...first.rows];
  const pages = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= pages; page += 1) {
    const chunk = await def.query({ ...filters, page, limit: pageSize });
    rows.push(...chunk.rows);
  }
  return { rows, total: first.total, meta: first.meta };
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

  /** Delegates to engine `vendor-settlement` so panels cannot drift from hub reports. */
  async adminVendorSettlements(query: ReportRangeQuery) {
    assertRange(query);
    const range = engineRange(query);
    const result = await fetchAllEngineRows('vendor-settlement', range);
    return {
      from: range.from,
      to: range.to,
      vendors: result.rows.map((row) => ({
        vendorId: String(row.vendorId ?? ''),
        vendorName: String(row.vendorName ?? ''),
        grossSales: 0,
        discountsAbsorbed: 0,
        commissionCharged: 0,
        tcsCharged: 0,
        netPaidOut: Number(row.payoutPaid ?? 0),
        pendingNet: Number(row.pendingNet ?? 0),
        settledNet: Number(row.settledNet ?? 0),
      })),
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

    const ledgers = await CommissionLedger.findAll({
      where: {
        vendorId,
        createdAt: { [Op.between]: [range.from, range.to] },
        status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
      },
      attributes: [
        'taxableAmountPaise',
        'taxableAmount',
        'saleAmount',
        'netPayoutAmountPaise',
        'netPayoutAmount',
        'commissionAmountPaise',
        'commissionAmount',
        'tcsAmountPaise',
        'tcsAmount',
        'discountAmountPaise',
        'discountAmount',
        'discountBearer',
        'status',
      ],
    });

    let salesPaise = 0;
    let commissionPaise = 0;
    let tcsPaise = 0;
    let netPaise = 0;
    let pendingPaise = 0;
    let settledPaise = 0;
    let vendorCouponDiscountPaise = 0;
    let platformCouponDiscountPaise = 0;

    for (const ledger of ledgers) {
      const taxable = frozenPaise(ledger.taxableAmountPaise, ledger.taxableAmount ?? ledger.saleAmount);
      const netRow = frozenPaise(
        ledger.netPayoutAmountPaise,
        ledger.netPayoutAmount != null
          ? ledger.netPayoutAmount
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount),
      );
      const commission = frozenPaise(ledger.commissionAmountPaise, ledger.commissionAmount);
      const tcs = frozenPaise(ledger.tcsAmountPaise, ledger.tcsAmount);
      const discount = frozenPaise(ledger.discountAmountPaise, ledger.discountAmount);

      salesPaise += taxable;
      commissionPaise += commission;
      tcsPaise += tcs;
      netPaise += netRow;
      if (ledger.status === COMMISSION_STATUS.PENDING) pendingPaise += netRow;
      if (ledger.status === COMMISSION_STATUS.SETTLED) settledPaise += netRow;

      if (discount > 0) {
        if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) {
          vendorCouponDiscountPaise += discount;
        } else {
          platformCouponDiscountPaise += discount;
        }
      }
    }

    return {
      from: range.from,
      to: range.to,
      vendorId,
      sales: fromPaise(salesPaise),
      commissionDeducted: fromPaise(commissionPaise),
      tcsDeducted: fromPaise(tcsPaise),
      discountAbsorbed: {
        ownCoupons: fromPaise(vendorCouponDiscountPaise),
        platformCouponsOnMyItems: fromPaise(platformCouponDiscountPaise),
      },
      netPayout: fromPaise(netPaise),
      upcomingPayout: fromPaise(pendingPaise),
      historicalPayout: fromPaise(settledPaise),
    };
  }

  /**
   * Outstanding customer wallet balances — DISTINCT ON latest ledger per user, SQL-paged.
   */
  async walletLiabilityReport(
    query: ReportRangeQuery & { page?: number; limit?: number },
  ): Promise<{
    totalLiability: number;
    customerCount: number;
    rows: Array<{ userId: string; balance: number; asOf: Date }>;
    pagination: ReturnType<typeof buildPaginationMeta>;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT);
    const offset = paginationOffset(page, limit);

    const [[totals]] = (await sequelize.query(
      `WITH latest AS (
         SELECT DISTINCT ON ("userId")
           "userId",
           "balanceAfter",
           "createdAt"
         FROM wallet_ledgers
         WHERE "deletedAt" IS NULL
         ORDER BY "userId", "createdAt" DESC
       )
       SELECT
         COUNT(*)::int AS "customerCount",
         COALESCE(SUM("balanceAfter"), 0)::float AS "totalLiability"
       FROM latest
       WHERE "balanceAfter" > 0`,
    )) as [Array<{ customerCount: number; totalLiability: number }>, unknown];

    const [rows] = (await sequelize.query(
      `WITH latest AS (
         SELECT DISTINCT ON ("userId")
           "userId" AS "userId",
           "balanceAfter" AS balance,
           "createdAt" AS "asOf"
         FROM wallet_ledgers
         WHERE "deletedAt" IS NULL
         ORDER BY "userId", "createdAt" DESC
       )
       SELECT "userId", balance, "asOf"
       FROM latest
       WHERE balance > 0
       ORDER BY balance DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: { limit, offset } },
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
