import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { fromPaise } from '@modules/pricing/money';
import { buildPaginationMeta } from '@core/http/pagination';
import { DEFAULT_PAGE_LIMIT } from '@core/constants/http';
import type { ReportRangeQuery } from './reports.dto';
import { getReportDefinition } from './engine/reportRegistry';
import { walletLiabilityTotals } from './definitions/legacyPanelReports';
import {
  inclusiveReportTo,
  computeReconciliationSummary,
  assertReportRange,
} from './engine/queryHelpers';

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
    const def = getReportDefinition('vendor-summary');
    if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);
    const result = await def.query({
      ...range,
      vendorId,
      scopedVendorId: vendorId,
      page: 1,
      limit: 1,
    });
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      from: range.from,
      to: range.to,
      vendorId,
      sales: Number(row.sales ?? 0),
      commissionDeducted: Number(row.commissionDeducted ?? 0),
      tcsDeducted: Number(row.tcsDeducted ?? 0),
      discountAbsorbed: {
        ownCoupons: Number(row.discountOwnCoupons ?? 0),
        platformCouponsOnMyItems: Number(row.discountPlatformCoupons ?? 0),
      },
      netPayout: Number(row.netPayout ?? 0),
      upcomingPayout: Number(row.upcomingPayout ?? 0),
      historicalPayout: Number(row.historicalPayout ?? 0),
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
    const def = getReportDefinition('wallet-liability');
    if (!def) throw new ValidationError(ERROR_MESSAGES.REPORT_NOT_FOUND);

    const [totals, result] = await Promise.all([
      walletLiabilityTotals(range),
      def.query({ ...range, page, limit }),
    ]);

    return {
      totalLiability: Math.round(totals.totalLiability * 100) / 100,
      customerCount: totals.customerCount,
      rows: result.rows.map((r) => ({
        userId: String(r.userId ?? ''),
        balance: Number(r.balance ?? 0),
        asOf: r.asOf as Date,
      })),
      pagination: buildPaginationMeta(result.total, page, limit),
    };
  }
}

export const reportsService = new ReportsService();
