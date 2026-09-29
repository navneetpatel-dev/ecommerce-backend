import { Op, type FindAndCountOptions, type Model, type ModelStatic } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { paginationOffset } from '@core/http/pagination';
import { reportExportConfig } from '../reportExportConfig';
import { fromPaise, toPaise } from '@modules/pricing/money';
import {
  REPORTABLE_ORDER_SQL,
  sqlFrozenPaise,
  sqlOrderPaymentPaise,
} from '@modules/pricing/frozenMoneySql';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ORDER_STATUS,
  DISCOUNT_BEARER,
} from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { IST_OFFSET_MS } from '@modules/pricing/istCalendar';
import type { ReportFilters, ReportQueryResult } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function isUtcMidnight(moment: Date): boolean {
  return moment.getTime() % DAY_MS === 0;
}

function isIstMidnight(moment: Date): boolean {
  return (moment.getTime() + IST_OFFSET_MS) % DAY_MS === 0;
}

/**
 * Report ranges are Indian calendar days. A date-only `from` (`2026-09-01`, parsed as
 * midnight UTC) starts at midnight IST on that date, not at 05:30 IST. A full
 * timestamp is kept as given.
 */
export function inclusiveReportFrom(from: Date): Date {
  return isUtcMidnight(from) ? new Date(from.getTime() - IST_OFFSET_MS) : new Date(from);
}

/**
 * A date-only `to` (midnight UTC, or midnight IST once normalised) runs to the end of
 * that day in IST (23:59:59.999 IST), so the selected end day is inclusive and a
 * monthly report covers exactly the IST month. A full timestamp is kept as given.
 */
export function inclusiveReportTo(to: Date): Date {
  if (isUtcMidnight(to)) return new Date(to.getTime() + DAY_MS - IST_OFFSET_MS - 1);
  if (isIstMidnight(to)) return new Date(to.getTime() + DAY_MS - 1);
  return new Date(to);
}

export function normalizeReportFilters(filters: ReportFilters): ReportFilters {
  return {
    ...filters,
    from: inclusiveReportFrom(filters.from),
    to: inclusiveReportTo(filters.to),
  };
}

export function assertReportRange(filters: ReportFilters) {
  if (filters.from > filters.to) {
    throw new ValidationError(ERROR_MESSAGES.REPORT_INVALID_RANGE);
  }
  const maxDays = reportExportConfig.maxRangeDays;
  const spanMs = filters.to.getTime() - filters.from.getTime();
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (spanMs > maxMs) {
    throw new ValidationError(ERROR_MESSAGES.REPORT_RANGE_TOO_WIDE);
  }
}

export function dateBetween(from: Date, to: Date): { [Op.between]: [Date, Date] } {
  return { [Op.between]: [from, to] };
}

export function reportPageParams(filters: ReportFilters): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.max(1, filters.limit ?? 50);
  return { page, limit, offset: paginationOffset(page, limit) };
}

/**
 * Sequelize form of `REPORTABLE_ORDER_SQL` — keep the two in step:
 * - Razorpay (etc.) once PAID
 * - COD once placed (not failed / refunded), even while paymentStatus is still PENDING
 * - never a cancelled order, even one still PAID while its refund is pending
 */
export function reportableOrderWhere(from?: Date, to?: Date): Record<string, unknown> {
  const where: Record<string, unknown> = {
    // A fully cancelled or fully RTO'd (RETURNED) order was refunded: not a sale.
    status: { [Op.notIn]: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] },
    [Op.or]: [
      { paymentStatus: PAYMENT_STATUS.PAID },
      {
        paymentMethod: PAYMENT_METHOD.COD,
        paymentStatus: { [Op.notIn]: [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.REFUNDED] },
      },
    ],
  };
  if (from && to) {
    where.createdAt = { [Op.between]: [from, to] };
  }
  return where;
}

/**
 * Frozen-money read primitives live in `@modules/pricing/frozenMoneySql` so analytics
 * and dashboards can share them without importing the reports engine. Re-exported here
 * because every existing report call site imports them from this module.
 */
export {
  frozenPaise,
  sqlFrozenPaise,
  REPORTABLE_ORDER_SQL,
  TCS_LEDGER_ORDER_SQL,
  sqlVendorNetPayoutPaise,
} from '@modules/pricing/frozenMoneySql';

/**
 * The settlement identity for orders placed in the range that count (REPORTABLE), in
 * paise, computed in SQL. Every rupee a customer paid (and kept or got back) is
 * accounted for exactly once:
 *
 *   customerPayments = vendorNetPayouts − platformFundedDiscount + platformCommission
 *                      + tcsCollected + platformGoodsSales + shippingCollected
 *                      − shippingRefunded + returnFeesKept + giftWrapCollected + refunds
 *
 * - vendorNetPayouts: the sale (and return-after-payout) ledgers' net — taxable value
 *   plus GST plus the platform-funded coupon share, less commission and TCS. GST is
 *   inside it (the vendor remits it), so `taxCollected` is shown but not added again.
 * - platformFundedDiscount: the coupon share the platform pays the vendor on top of what
 *   the customer paid (derived exactly from each ledger's frozen amounts).
 * - tcsCollected: the section 52 TCS withheld from those ledgers.
 * - platformGoodsSales: goods the platform sells itself (no vendor ledger).
 * - shipping and gift wrap: the platform's own fees; shipping refunded with returns and
 *   the return fees kept from refunds adjust it.
 * - refunds: what approved returns give back (their accounting is frozen at approval,
 *   when the parts' amounts are reduced).
 * Cancelled and RTO'd parts leave both sides (their payment was refunded, their
 * ledgers deleted). With a vendor, only that vendor's parts count (no platform fees).
 */
export async function computeReconciliationSummary(filters: {
  from: Date;
  to: Date;
  vendorId?: string | null;
}): Promise<{
  customerPaymentsPaise: number;
  vendorNetPayoutsPaise: number;
  platformFundedDiscountPaise: number;
  platformCommissionPaise: number;
  taxCollectedPaise: number;
  tcsCollectedPaise: number;
  platformGoodsPaise: number;
  shippingCollectedPaise: number;
  shippingRefundedPaise: number;
  returnFeesKeptPaise: number;
  giftWrapPaise: number;
  refundsPaise: number;
  accountedPaise: number;
  gmvPaise: number;
  merchandiseDiscountPaise: number;
  platformDiscountPaise: number;
  vendorDiscountPaise: number;
}> {
  const vendorId = filters.vendorId ?? null;
  const taxExpr = sqlFrozenPaise('s', 'taxAmountPaise');
  const shipCost = sqlFrozenPaise('s', 'shippingCostPaise');
  const shipDisc = sqlFrozenPaise('s', 'shippingDiscountAmountPaise');
  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise');
  const merchDiscExpr = sqlFrozenPaise('s', 'discountAmountPaise');
  const ledgerDisc = sqlFrozenPaise('cl', 'discountAmountPaise');
  // What a ledger's net holds beyond taxable + GST − commission − TCS: the platform's coupon share.
  const platformFundedExpr = `(cl."netPayoutAmountPaise" - cl."taxableAmountPaise" - cl."taxAmountPaise"
    + cl."commissionAmountPaise" + cl."tcsAmountPaise")`;

  const [rows] = await sequelize.query(
    `
    WITH reportable_orders AS (
      SELECT
        o.id,
        ${sqlOrderPaymentPaise('o')} AS "paymentPaise",
        ROUND(COALESCE(o."giftWrapFeeAmount", 0)::numeric * 100)::bigint AS "giftWrapPaise"
      FROM orders o
      WHERE o."deletedAt" IS NULL
        AND o."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
    ),
    scoped_subs AS (
      SELECT s.*
      FROM sub_orders s
      INNER JOIN reportable_orders ro ON ro.id = s."orderId"
      WHERE s."deletedAt" IS NULL
        AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
        -- A cancelled or RTO'd (RETURNED) part was refunded and its ledgers deleted:
        -- it leaves GMV, tax, shipping and the payments alike (GMV_SUB_ORDER_SQL).
        AND s."status" NOT IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')
    ),
    sub_totals AS (
      SELECT
        COALESCE(SUM(${taxExpr}), 0)::bigint AS "taxPaise",
        COALESCE(SUM(GREATEST(0, (${shipCost}) - (${shipDisc}))), 0)::bigint AS "shippingPaise",
        COALESCE(SUM(${subtotalExpr}), 0)::bigint AS "gmvPaise",
        COALESCE(SUM(${merchDiscExpr}), 0)::bigint AS "merchandiseDiscountPaise",
        COALESCE(SUM(CASE WHEN s."vendorId" IS NULL
          THEN s."taxableAmountPaise" + s."taxAmountPaise" ELSE 0 END), 0)::bigint AS "platformGoodsPaise",
        COALESCE(SUM(s."taxableAmountPaise" + s."taxAmountPaise"
          + GREATEST(0, (${shipCost}) - (${shipDisc}))), 0)::bigint AS "standingPaise"
      FROM scoped_subs s
    ),
    ledger_totals AS (
      -- Sale ledgers and returns after payout; not a vendor-borne cashback cost, which
      -- is paid to the customer's wallet, not out of what the customer paid.
      SELECT
        COALESCE(SUM(cl."commissionAmountPaise"), 0)::bigint AS "commissionPaise",
        COALESCE(SUM(cl."netPayoutAmountPaise"), 0)::bigint AS "netPaise",
        COALESCE(SUM(cl."tcsAmountPaise"), 0)::bigint AS "tcsPaise",
        COALESCE(SUM(${platformFundedExpr}), 0)::bigint AS "platformFundedPaise",
        COALESCE(SUM(CASE
          WHEN cl."discountBearer" = '${DISCOUNT_BEARER.VENDOR}' THEN ${ledgerDisc}
          ELSE 0
        END), 0)::bigint AS "vendorDiscountPaise",
        COALESCE(SUM(CASE
          WHEN cl."discountBearer" IS DISTINCT FROM '${DISCOUNT_BEARER.VENDOR}' THEN ${ledgerDisc}
          ELSE 0
        END), 0)::bigint AS "platformDiscountPaise"
      FROM commission_ledgers cl
      INNER JOIN scoped_subs s ON s.id = cl."subOrderId"
      WHERE cl."deletedAt" IS NULL
        AND (cl."referenceType" IS NULL OR cl."referenceType" = '${COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK}')
    ),
    return_totals AS (
      -- Approved returns on these parts: what goes back to the customer, the goods and
      -- tax reversed, the shipping refunded, and the fee kept (the difference).
      SELECT
        COALESCE(SUM(ROUND(rr."refundAmount"::numeric * 100)), 0)::bigint AS "refundsPaise",
        COALESCE(SUM(COALESCE(rr."refundMerchandiseAmountPaise", 0)
          + ROUND(COALESCE(rr."refundTaxAmount", 0)::numeric * 100)), 0)::bigint AS "returnedGoodsPaise",
        COALESCE(SUM(ROUND(COALESCE(rr."shippingRefundAmount", 0)::numeric * 100)), 0)::bigint AS "shippingRefundedPaise"
      FROM return_requests rr
      INNER JOIN scoped_subs s ON s.id = rr."subOrderId"
      WHERE rr."deletedAt" IS NULL
        AND rr."refundAmount" IS NOT NULL
    ),
    payment_totals AS (
      SELECT
        CASE WHEN :vendorId::uuid IS NULL
          THEN (SELECT COALESCE(SUM("paymentPaise"), 0) FROM reportable_orders)
          -- One vendor: what the customer paid for its parts (as they stand, plus what
          -- its returns gave back).
          ELSE (SELECT "standingPaise" FROM sub_totals) + (SELECT "returnedGoodsPaise" FROM return_totals)
        END::bigint AS "customerPaymentsPaise",
        CASE WHEN :vendorId::uuid IS NULL
          THEN (SELECT COALESCE(SUM("giftWrapPaise"), 0) FROM reportable_orders)
          ELSE 0
        END::bigint AS "giftWrapPaise"
    )
    SELECT
      p."customerPaymentsPaise",
      p."giftWrapPaise",
      l."netPaise" AS "vendorNetPayoutsPaise",
      l."platformFundedPaise" AS "platformFundedDiscountPaise",
      l."commissionPaise" AS "platformCommissionPaise",
      l."tcsPaise" AS "tcsCollectedPaise",
      s."taxPaise" AS "taxCollectedPaise",
      s."platformGoodsPaise",
      s."shippingPaise" AS "shippingCollectedPaise",
      r."shippingRefundedPaise",
      (r."returnedGoodsPaise" + r."shippingRefundedPaise" - r."refundsPaise")::bigint AS "returnFeesKeptPaise",
      r."refundsPaise",
      s."gmvPaise",
      s."merchandiseDiscountPaise",
      l."platformDiscountPaise",
      l."vendorDiscountPaise"
    FROM payment_totals p
    CROSS JOIN sub_totals s
    CROSS JOIN ledger_totals l
    CROSS JOIN return_totals r
    `,
    { replacements: { from: filters.from, to: filters.to, vendorId } },
  );

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);
  const summary = {
    customerPaymentsPaise: n('customerPaymentsPaise'),
    vendorNetPayoutsPaise: n('vendorNetPayoutsPaise'),
    platformFundedDiscountPaise: n('platformFundedDiscountPaise'),
    platformCommissionPaise: n('platformCommissionPaise'),
    taxCollectedPaise: n('taxCollectedPaise'),
    tcsCollectedPaise: n('tcsCollectedPaise'),
    platformGoodsPaise: n('platformGoodsPaise'),
    shippingCollectedPaise: n('shippingCollectedPaise'),
    shippingRefundedPaise: n('shippingRefundedPaise'),
    returnFeesKeptPaise: n('returnFeesKeptPaise'),
    giftWrapPaise: n('giftWrapPaise'),
    refundsPaise: n('refundsPaise'),
    gmvPaise: n('gmvPaise'),
    merchandiseDiscountPaise: n('merchandiseDiscountPaise'),
    platformDiscountPaise: n('platformDiscountPaise'),
    vendorDiscountPaise: n('vendorDiscountPaise'),
  };
  return {
    ...summary,
    accountedPaise:
      summary.vendorNetPayoutsPaise -
      summary.platformFundedDiscountPaise +
      summary.platformCommissionPaise +
      summary.tcsCollectedPaise +
      summary.platformGoodsPaise +
      summary.shippingCollectedPaise -
      summary.shippingRefundedPaise +
      summary.returnFeesKeptPaise +
      summary.giftWrapPaise +
      summary.refundsPaise,
  };
}

export function paidOrderInclude(from: Date, to: Date): Record<string, unknown> {
  return {
    model: Order,
    as: 'order',
    required: true,
    where: reportableOrderWhere(from, to),
    attributes: [
      'id',
      'totalAmount',
      'originalTotalAmount',
      'discountTotal',
      'couponId',
      'paymentStatus',
      'paymentMethod',
      'createdAt',
      'userId',
      'status',
    ],
  };
}

/** Join Order so TCS rows for unpaid/cancelled checkouts are excluded. */
export function reportableOrderJoin(): Record<string, unknown> {
  return {
    model: Order,
    required: true,
    where: reportableOrderWhere(),
    attributes: ['id', 'paymentStatus', 'paymentMethod', 'status'],
  };
}

/** True SQL pagination via findAndCountAll (list / 1:1 reports). */
export async function pagedFindAndCount<M extends Model>(
  model: ModelStatic<M>,
  options: FindAndCountOptions,
  filters: ReportFilters,
): Promise<{ rows: M[]; total: number }> {
  const { limit, offset } = reportPageParams(filters);
  if (filters._exportSkipCount && filters._exportKnownTotal != null) {
    const rows = await model.findAll({
      ...options,
      limit,
      offset,
    });
    return { rows, total: filters._exportKnownTotal };
  }
  const { rows, count } = await model.findAndCountAll({
    ...options,
    limit,
    offset,
    distinct: options.distinct !== false,
    col: options.col ?? 'id',
  });
  const total = Array.isArray(count) ? count.length : Number(count);
  return { rows, total };
}

/**
 * Paginate a SQL SELECT that already returns one row per report line
 * (typically a GROUP BY / UNION). Runs COUNT(*) over the same subquery,
 * then LIMIT/OFFSET — never loads the full aggregate set into Node.
 */
export async function pagedSqlQuery<T extends Record<string, unknown>>(opts: {
  /** SELECT ... (GROUP BY / UNION) — no ORDER BY / LIMIT */
  selectSql: string;
  orderBySql: string;
  replacements: Record<string, unknown>;
  filters: ReportFilters;
  mapRow: (row: Record<string, unknown>) => T;
}): Promise<ReportQueryResult> {
  const { limit, offset } = reportPageParams(opts.filters);
  let total: number;
  if (opts.filters._exportSkipCount && opts.filters._exportKnownTotal != null) {
    total = opts.filters._exportKnownTotal;
  } else {
    const [countRows] = await sequelize.query(
      `SELECT COUNT(*)::int AS total FROM (${opts.selectSql}) AS _report_agg`,
      { replacements: opts.replacements },
    );
    total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0);
  }
  if (total === 0) return { rows: [], total: 0 };

  const [rows] = await sequelize.query(
    `${opts.selectSql} ORDER BY ${opts.orderBySql} LIMIT :_limit OFFSET :_offset`,
    {
      replacements: {
        ...opts.replacements,
        _limit: limit,
        _offset: offset,
      },
    },
  );
  return {
    rows: (rows as Array<Record<string, unknown>>).map(opts.mapRow),
    total,
  };
}

/** Empty page helper matching ReportQueryResult. */
export function emptyPage(filters: ReportFilters): ReportQueryResult {
  reportPageParams(filters);
  return { rows: [], total: 0 };
}

export async function loadPaidSubOrders(filters: ReportFilters) {
  const where: Record<string, unknown> = {};
  if (filters.scopedVendorId || filters.vendorId) {
    where.vendorId = filters.scopedVendorId ?? filters.vendorId;
  }
  return SubOrder.findAll({
    where,
    include: [paidOrderInclude(filters.from, filters.to)],
  });
}

export async function loadLedgersForSubOrders(subOrderIds: string[]) {
  if (!subOrderIds.length) return [];
  return CommissionLedger.findAll({
    where: {
      subOrderId: { [Op.in]: subOrderIds },
      status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
    },
  });
}

export { fromPaise, toPaise, DISCOUNT_BEARER, COMMISSION_STATUS, PAYMENT_STATUS };
