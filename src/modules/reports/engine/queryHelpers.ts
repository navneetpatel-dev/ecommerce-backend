import { Op, type FindAndCountOptions, type Model, type ModelStatic } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { paginationOffset } from '@core/http/pagination';
import { reportExportConfig } from '../reportExportConfig';
import { fromPaise, toPaise } from '@modules/pricing/money';
import {
  REPORTABLE_ORDER_SQL,
  sqlFrozenPaise,
  sqlVendorNetPayoutPaise,
} from '@modules/pricing/frozenMoneySql';
import {
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
import type { ReportFilters, ReportQueryResult } from './types';

/** Extend date-only `to` (midnight UTC) so the selected end day is inclusive. */
export function inclusiveReportTo(to: Date): Date {
  const end = new Date(to);
  if (
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 &&
    end.getUTCMilliseconds() === 0
  ) {
    end.setUTCHours(23, 59, 59, 999);
  }
  return end;
}

export function normalizeReportFilters(filters: ReportFilters): ReportFilters {
  return { ...filters, to: inclusiveReportTo(filters.to) };
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
 * Orders that count toward GMV / tax / recon reports:
 * - Razorpay (etc.) once PAID
 * - COD once placed (not cancelled / failed), even while paymentStatus is still PENDING
 */
export function reportableOrderWhere(from?: Date, to?: Date): Record<string, unknown> {
  const where: Record<string, unknown> = {
    [Op.or]: [
      { paymentStatus: PAYMENT_STATUS.PAID },
      {
        paymentMethod: PAYMENT_METHOD.COD,
        paymentStatus: { [Op.notIn]: [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.REFUNDED] },
        status: { [Op.ne]: ORDER_STATUS.CANCELLED },
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
  sqlVendorNetPayoutPaise,
} from '@modules/pricing/frozenMoneySql';

/**
 * Single-row settlement identity computed entirely in SQL (no Node-side load-all).
 * TCS comes from tcs_ledgers (PricingEngine frozen rows), not recomputed from commission.
 */
export async function computeReconciliationSummary(filters: {
  from: Date;
  to: Date;
  vendorId?: string | null;
}): Promise<{
  customerPaymentsPaise: number;
  vendorNetPayoutsPaise: number;
  platformCommissionPaise: number;
  taxCollectedPaise: number;
  tcsCollectedPaise: number;
  shippingCollectedPaise: number;
  refundsPaise: number;
  gmvPaise: number;
  merchandiseDiscountPaise: number;
  platformDiscountPaise: number;
  vendorDiscountPaise: number;
}> {
  const vendorId = filters.vendorId ?? null;
  const taxExpr = sqlFrozenPaise('s', 'taxAmountPaise', 'taxAmount');
  const shipCost = sqlFrozenPaise('s', 'shippingCostPaise', 'shippingCost');
  const shipDisc = sqlFrozenPaise('s', 'shippingDiscountAmountPaise', 'shippingDiscountAmount');
  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise', 'subtotal');
  const merchDiscExpr = sqlFrozenPaise('s', 'discountAmountPaise', 'discountAmount');
  const commissionExpr = sqlFrozenPaise('cl', 'commissionAmountPaise', 'commissionAmount');
  const netExpr = sqlVendorNetPayoutPaise('cl');
  const ledgerDisc = sqlFrozenPaise('cl', 'discountAmountPaise', 'discountAmount');

  const [rows] = await sequelize.query(
    `
    WITH reportable_orders AS (
      SELECT
        o.id,
        CASE
          WHEN COALESCE(o."originalTotalAmount", 0) > 0
            THEN ROUND(o."originalTotalAmount"::numeric * 100)::bigint
          ELSE ROUND(COALESCE(o."totalAmount", 0)::numeric * 100)::bigint
        END AS "paymentPaise"
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
    ),
    sub_totals AS (
      SELECT
        COALESCE(SUM(${taxExpr}), 0)::bigint AS "taxPaise",
        COALESCE(SUM(GREATEST(0, (${shipCost}) - (${shipDisc}))), 0)::bigint AS "shippingPaise",
        -- GMV counts only sub-orders that were not cancelled (GMV_SUB_ORDER_SQL);
        -- tax, shipping and discounts above/below keep every scoped sub-order.
        COALESCE(SUM(${subtotalExpr}) FILTER (
          WHERE s."status" <> '${ORDER_STATUS.CANCELLED}'
        ), 0)::bigint AS "gmvPaise",
        COALESCE(SUM(${merchDiscExpr}), 0)::bigint AS "merchandiseDiscountPaise"
      FROM scoped_subs s
    ),
    ledger_totals AS (
      SELECT
        COALESCE(SUM(${commissionExpr}), 0)::bigint AS "commissionPaise",
        COALESCE(SUM(${netExpr}), 0)::bigint AS "netPaise",
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
        AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
    ),
    tcs_totals AS (
      SELECT COALESCE(SUM(t."tcsAmountPaise"), 0)::bigint AS "tcsPaise"
      FROM tcs_ledgers t
      INNER JOIN reportable_orders ro ON ro.id = t."orderId"
      WHERE t."deletedAt" IS NULL
        AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)
    ),
    payment_totals AS (
      SELECT COALESCE(SUM(ro."paymentPaise"), 0)::bigint AS "customerPaymentsPaise"
      FROM reportable_orders ro
      WHERE :vendorId::uuid IS NULL
         OR EXISTS (
           SELECT 1 FROM scoped_subs s WHERE s."orderId" = ro.id
         )
    ),
    refund_totals AS (
      SELECT COALESCE(SUM(cn."totalPaise"), 0)::bigint AS "refundsPaise"
      FROM credit_notes cn
      INNER JOIN reportable_orders ro ON ro.id = cn."orderId"
      WHERE cn."deletedAt" IS NULL
        AND (
          :vendorId::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM scoped_subs s WHERE s."orderId" = cn."orderId"
          )
        )
    )
    SELECT
      p."customerPaymentsPaise",
      l."netPaise" AS "vendorNetPayoutsPaise",
      l."commissionPaise" AS "platformCommissionPaise",
      s."taxPaise" AS "taxCollectedPaise",
      t."tcsPaise" AS "tcsCollectedPaise",
      s."shippingPaise" AS "shippingCollectedPaise",
      r."refundsPaise",
      s."gmvPaise",
      s."merchandiseDiscountPaise",
      l."platformDiscountPaise",
      l."vendorDiscountPaise"
    FROM payment_totals p
    CROSS JOIN sub_totals s
    CROSS JOIN ledger_totals l
    CROSS JOIN tcs_totals t
    CROSS JOIN refund_totals r
    `,
    { replacements: { from: filters.from, to: filters.to, vendorId } },
  );

  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    customerPaymentsPaise: Number(row.customerPaymentsPaise ?? 0),
    vendorNetPayoutsPaise: Number(row.vendorNetPayoutsPaise ?? 0),
    platformCommissionPaise: Number(row.platformCommissionPaise ?? 0),
    taxCollectedPaise: Number(row.taxCollectedPaise ?? 0),
    tcsCollectedPaise: Number(row.tcsCollectedPaise ?? 0),
    shippingCollectedPaise: Number(row.shippingCollectedPaise ?? 0),
    refundsPaise: Number(row.refundsPaise ?? 0),
    gmvPaise: Number(row.gmvPaise ?? 0),
    merchandiseDiscountPaise: Number(row.merchandiseDiscountPaise ?? 0),
    platformDiscountPaise: Number(row.platformDiscountPaise ?? 0),
    vendorDiscountPaise: Number(row.vendorDiscountPaise ?? 0),
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
