import {
  assertReportRange,
  fromPaise,
  dateBetween,
  REPORTABLE_ORDER_SQL,
  pagedFindAndCount,
  pagedSqlQuery,
  computeReconciliationSummary,
  sqlFrozenPaise,
  DISCOUNT_BEARER,
  COMMISSION_STATUS,
} from '../engine/queryHelpers';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { AuditLog } from '@database/models/auditLog.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { PERMISSIONS } from '@core/permissions/permissionKeys';

function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

function sqlReplacements(filters: ReportFilters): Record<string, unknown> {
  return {
    from: filters.from,
    to: filters.to,
    vendorId: resolveVendorId(filters),
    categoryId: filters.categoryId ?? null,
    status: filters.status ?? null,
  };
}

async function gstTcsSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)`;
  return pagedSqlQuery({
    selectSql: gstTcsSelectSql(vendorFilter),
    orderBySql: `"groupType" ASC, period DESC, state ASC, "vendorId" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapGstTcsRow,
  });
}

function gstTcsSelectSql(vendorFilter: string): string {
  const periodExpr = `COALESCE(t.period, to_char(t."createdAt", 'YYYY-MM'))`;
  const stateExpr = `COALESCE(NULLIF(t."placeOfSupplyState", ''), v.state, '')`;
  const sectionExpr = `COALESCE(NULLIF(t.section, ''), '52')`;
  return `
    SELECT
      'VENDOR'::text AS "groupType",
      t."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      MAX(COALESCE(NULLIF(t."vendorGstin", ''), v."gstNumber", '')) AS "vendorGstin",
      ${stateExpr} AS state,
      ${periodExpr} AS period,
      ${sectionExpr} AS section,
      MAX(COALESCE(t."entryType", 'COLLECTION')) AS "entryType",
      SUM(t."taxableAmountPaise")::bigint AS "taxableValuePaise",
      SUM(t."tcsCgstPaise")::bigint AS "tcsCgstPaise",
      SUM(t."tcsSgstPaise")::bigint AS "tcsSgstPaise",
      SUM(t."tcsIgstPaise")::bigint AS "tcsIgstPaise",
      SUM(t."tcsAmountPaise")::bigint AS "tcsTotalPaise"
    FROM tcs_ledgers t
    INNER JOIN vendors v ON v.id = t."vendorId" AND v."deletedAt" IS NULL
    INNER JOIN orders o ON o.id = t."orderId" AND o."deletedAt" IS NULL
    WHERE t."deletedAt" IS NULL
      AND t."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      ${vendorFilter}
    GROUP BY t."vendorId", ${stateExpr}, ${periodExpr}, ${sectionExpr}, COALESCE(t."entryType", 'COLLECTION')

    UNION ALL

    SELECT
      'STATE'::text AS "groupType",
      ''::text AS "vendorId",
      ''::text AS "vendorName",
      ''::text AS "vendorGstin",
      ${stateExpr} AS state,
      ${periodExpr} AS period,
      ${sectionExpr} AS section,
      MAX(COALESCE(t."entryType", 'COLLECTION')) AS "entryType",
      SUM(t."taxableAmountPaise")::bigint AS "taxableValuePaise",
      SUM(t."tcsCgstPaise")::bigint AS "tcsCgstPaise",
      SUM(t."tcsSgstPaise")::bigint AS "tcsSgstPaise",
      SUM(t."tcsIgstPaise")::bigint AS "tcsIgstPaise",
      SUM(t."tcsAmountPaise")::bigint AS "tcsTotalPaise"
    FROM tcs_ledgers t
    INNER JOIN vendors v ON v.id = t."vendorId" AND v."deletedAt" IS NULL
    INNER JOIN orders o ON o.id = t."orderId" AND o."deletedAt" IS NULL
    WHERE t."deletedAt" IS NULL
      AND t."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      ${vendorFilter}
    GROUP BY ${stateExpr}, ${periodExpr}, ${sectionExpr}, COALESCE(t."entryType", 'COLLECTION')
  `;
}

function mapGstTcsRow(row: Record<string, unknown>) {
  return {
    groupType: String(row.groupType ?? ''),
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    vendorGstin: String(row.vendorGstin ?? ''),
    state: String(row.state ?? ''),
    period: String(row.period ?? ''),
    section: String(row.section ?? '52'),
    entryType: String(row.entryType ?? 'COLLECTION'),
    taxableValue: fromPaise(Number(row.taxableValuePaise ?? 0)),
    tcsCgst: fromPaise(Number(row.tcsCgstPaise ?? 0)),
    tcsSgst: fromPaise(Number(row.tcsSgstPaise ?? 0)),
    tcsIgst: fromPaise(Number(row.tcsIgstPaise ?? 0)),
    tcsTotal: fromPaise(Number(row.tcsTotalPaise ?? 0)),
  };
}

const GST_TCS_KEYSET: KeysetOrderCol[] = [
  { column: 'groupType', direction: 'ASC' },
  { column: 'period', direction: 'DESC' },
  { column: 'state', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
];

async function gstTcsExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)`;
  const page = await keysetSqlQuery({
    selectSql: gstTcsSelectSql(vendorFilter),
    order: GST_TCS_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapGstTcsRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function tds194oSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const periodExpr = `COALESCE(t.period, to_char(t."createdAt", 'YYYY-MM'))`;
  const sectionExpr = `COALESCE(NULLIF(t.section, ''), '194O')`;

  const selectSql = `
    SELECT
      t."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      ${periodExpr} AS period,
      ${sectionExpr} AS section,
      SUM(t."taxableAmountPaise")::bigint AS "grossTaxablePaise",
      SUM(t."tdsAmountPaise")::bigint AS "tdsAmountPaise"
    FROM tds_ledgers t
    INNER JOIN vendors v ON v.id = t."vendorId" AND v."deletedAt" IS NULL
    WHERE t."deletedAt" IS NULL
      AND t."createdAt" BETWEEN :from AND :to
      AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)
    GROUP BY t."vendorId", ${periodExpr}, ${sectionExpr}
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `period DESC, "vendorId" ASC, section ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      vendorId: String(row.vendorId ?? ''),
      vendorName: String(row.vendorName ?? ''),
      period: String(row.period ?? ''),
      section: String(row.section ?? '194O'),
      grossTaxable: fromPaise(Number(row.grossTaxablePaise ?? 0)),
      tdsAmount: fromPaise(Number(row.tdsAmountPaise ?? 0)),
    }),
  });
}

async function hsnSalesSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const taxableExpr = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');
  const taxExpr = sqlFrozenPaise('oi', 'taxAmountPaise', 'taxAmount');

  const selectSql = `
    SELECT
      COALESCE(hsn."hsnCode", 'UNKNOWN') AS "hsnCode",
      SUM(oi.quantity)::int AS qty,
      SUM(${taxableExpr})::bigint AS "taxablePaise",
      SUM(${taxExpr})::bigint AS "taxPaise"
    FROM order_items oi
    INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
    INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
    LEFT JOIN (
      SELECT DISTINCT ON (tr."categoryId")
        tr."categoryId",
        tr."hsnCode"
      FROM tax_rules tr
      WHERE tr."deletedAt" IS NULL
        AND tr."hsnCode" IS NOT NULL
      ORDER BY tr."categoryId", tr."updatedAt" DESC NULLS LAST
    ) hsn ON hsn."categoryId" = p."categoryId"
    WHERE oi."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId)
    GROUP BY COALESCE(hsn."hsnCode", 'UNKNOWN')
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"hsnCode" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      hsnCode: String(row.hsnCode ?? 'UNKNOWN'),
      qty: Number(row.qty ?? 0),
      taxable: fromPaise(Number(row.taxablePaise ?? 0)),
      tax: fromPaise(Number(row.taxPaise ?? 0)),
    }),
  });
}

async function stateTaxCollection(filters: ReportFilters) {
  assertReportRange(filters);
  const taxTotalExpr = sqlFrozenPaise('s', 'taxAmountPaise', 'taxAmount');

  const selectSql = `
    SELECT
      COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state,
      SUM(COALESCE((s."taxBreakdown"->>'cgst')::numeric, 0)) AS cgst,
      SUM(COALESCE((s."taxBreakdown"->>'sgst')::numeric, 0)) AS sgst,
      SUM(COALESCE((s."taxBreakdown"->>'igst')::numeric, 0)) AS igst,
      SUM(${taxTotalExpr})::bigint AS "taxTotalPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
    GROUP BY COALESCE(NULLIF(a.state, ''), 'UNKNOWN')
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `state ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      state: String(row.state ?? 'UNKNOWN'),
      cgst: Math.round(Number(row.cgst ?? 0) * 100) / 100,
      sgst: Math.round(Number(row.sgst ?? 0) * 100) / 100,
      igst: Math.round(Number(row.igst ?? 0) * 100) / 100,
      taxTotal: fromPaise(Number(row.taxTotalPaise ?? 0)),
    }),
  });
}

function tds194oSelectSql(): string {
  const periodExpr = `COALESCE(t.period, to_char(t."createdAt", 'YYYY-MM'))`;
  const sectionExpr = `COALESCE(NULLIF(t.section, ''), '194O')`;
  return `
    SELECT
      t."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      ${periodExpr} AS period,
      ${sectionExpr} AS section,
      SUM(t."taxableAmountPaise")::bigint AS "grossTaxablePaise",
      SUM(t."tdsAmountPaise")::bigint AS "tdsAmountPaise"
    FROM tds_ledgers t
    INNER JOIN vendors v ON v.id = t."vendorId" AND v."deletedAt" IS NULL
    WHERE t."deletedAt" IS NULL
      AND t."createdAt" BETWEEN :from AND :to
      AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)
    GROUP BY t."vendorId", ${periodExpr}, ${sectionExpr}
  `;
}

function mapTds194oRow(row: Record<string, unknown>) {
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    period: String(row.period ?? ''),
    section: String(row.section ?? '194O'),
    grossTaxable: fromPaise(Number(row.grossTaxablePaise ?? 0)),
    tdsAmount: fromPaise(Number(row.tdsAmountPaise ?? 0)),
  };
}

const TDS_194O_KEYSET: KeysetOrderCol[] = [
  { column: 'period', direction: 'DESC' },
  { column: 'vendorId', direction: 'ASC' },
  { column: 'section', direction: 'ASC' },
];

async function tds194oExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  const page = await keysetSqlQuery({
    selectSql: tds194oSelectSql(),
    order: TDS_194O_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapTds194oRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

function hsnSalesSelectSql(): string {
  const taxableExpr = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');
  const taxExpr = sqlFrozenPaise('oi', 'taxAmountPaise', 'taxAmount');
  return `
    SELECT
      COALESCE(hsn."hsnCode", 'UNKNOWN') AS "hsnCode",
      SUM(oi.quantity)::int AS qty,
      SUM(${taxableExpr})::bigint AS "taxablePaise",
      SUM(${taxExpr})::bigint AS "taxPaise"
    FROM order_items oi
    INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
    INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
    LEFT JOIN (
      SELECT DISTINCT ON (tr."categoryId")
        tr."categoryId",
        tr."hsnCode"
      FROM tax_rules tr
      WHERE tr."deletedAt" IS NULL
        AND tr."hsnCode" IS NOT NULL
      ORDER BY tr."categoryId", tr."updatedAt" DESC NULLS LAST
    ) hsn ON hsn."categoryId" = p."categoryId"
    WHERE oi."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId)
    GROUP BY COALESCE(hsn."hsnCode", 'UNKNOWN')
  `;
}

function mapHsnSalesRow(row: Record<string, unknown>) {
  return {
    hsnCode: String(row.hsnCode ?? 'UNKNOWN'),
    qty: Number(row.qty ?? 0),
    taxable: fromPaise(Number(row.taxablePaise ?? 0)),
    tax: fromPaise(Number(row.taxPaise ?? 0)),
  };
}

const HSN_SALES_KEYSET: KeysetOrderCol[] = [{ column: 'hsnCode', direction: 'ASC' }];

async function hsnSalesExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  const page = await keysetSqlQuery({
    selectSql: hsnSalesSelectSql(),
    order: HSN_SALES_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapHsnSalesRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

function stateTaxSelectSql(): string {
  const taxTotalExpr = sqlFrozenPaise('s', 'taxAmountPaise', 'taxAmount');
  return `
    SELECT
      COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state,
      SUM(COALESCE((s."taxBreakdown"->>'cgst')::numeric, 0)) AS cgst,
      SUM(COALESCE((s."taxBreakdown"->>'sgst')::numeric, 0)) AS sgst,
      SUM(COALESCE((s."taxBreakdown"->>'igst')::numeric, 0)) AS igst,
      SUM(${taxTotalExpr})::bigint AS "taxTotalPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
    GROUP BY COALESCE(NULLIF(a.state, ''), 'UNKNOWN')
  `;
}

function mapStateTaxRow(row: Record<string, unknown>) {
  return {
    state: String(row.state ?? 'UNKNOWN'),
    cgst: Math.round(Number(row.cgst ?? 0) * 100) / 100,
    sgst: Math.round(Number(row.sgst ?? 0) * 100) / 100,
    igst: Math.round(Number(row.igst ?? 0) * 100) / 100,
    taxTotal: fromPaise(Number(row.taxTotalPaise ?? 0)),
  };
}

const STATE_TAX_KEYSET: KeysetOrderCol[] = [{ column: 'state', direction: 'ASC' }];

async function stateTaxExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  const page = await keysetSqlQuery({
    selectSql: stateTaxSelectSql(),
    order: STATE_TAX_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapStateTaxRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function reconciliation(filters: ReportFilters) {
  assertReportRange(filters);
  const summary = await computeReconciliationSummary({
    from: filters.from,
    to: filters.to,
    vendorId: resolveVendorId(filters),
  });

  const customerPayments = fromPaise(summary.customerPaymentsPaise);
  const vendorNetPayouts = fromPaise(summary.vendorNetPayoutsPaise);
  const platformCommission = fromPaise(summary.platformCommissionPaise);
  const taxCollected = fromPaise(summary.taxCollectedPaise);
  const tcsCollected = fromPaise(summary.tcsCollectedPaise);
  const shippingCollected = fromPaise(summary.shippingCollectedPaise);
  const refundsToCustomer = fromPaise(summary.refundsPaise);
  const accountedPaise =
    summary.vendorNetPayoutsPaise +
    summary.platformCommissionPaise +
    summary.taxCollectedPaise +
    summary.tcsCollectedPaise +
    summary.shippingCollectedPaise +
    summary.refundsPaise;
  const differencePaise = summary.customerPaymentsPaise - accountedPaise;
  const balanced = differencePaise === 0;
  const row = {
    customerPayments,
    vendorNetPayouts,
    platformCommission,
    taxCollected,
    tcsCollected,
    shippingCollected,
    refundsToCustomer,
    accountedTotal: fromPaise(accountedPaise),
    difference: fromPaise(differencePaise),
    status: balanced ? 'BALANCED' : 'MISMATCH',
  };
  const meta = {
    ...row,
    balanced,
    error: balanced ? null : ERROR_MESSAGES.REPORT_RECONCILIATION_MISMATCH,
    from: filters.from,
    to: filters.to,
  };
  return { rows: [row], total: 1, meta };
}

async function creditDebitNoteRegister(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: creditDebitNoteSelectSql(),
    orderBySql: `"issuedAt" DESC, "noteNumber" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapCreditDebitNoteRow,
  });
}

const CREDIT_DEBIT_KEYSET: KeysetOrderCol[] = [
  { column: 'issuedAt', direction: 'DESC' },
  { column: 'noteNumber', direction: 'DESC' },
];

function creditDebitNoteSelectSql(): string {
  const noteInRange = (alias: string) => `(
    (${alias}."issuedAt" IS NOT NULL AND ${alias}."issuedAt" BETWEEN :from AND :to)
    OR (${alias}."issuedAt" IS NULL AND ${alias}."createdAt" BETWEEN :from AND :to)
  )`;
  return `
    SELECT
      'CREDIT'::text AS type,
      cn.number AS "noteNumber",
      cn."orderId"::text AS "orderId",
      COALESCE(cn."subOrderId"::text, '') AS "subOrderId",
      COALESCE(cn."vendorId"::text, '') AS "vendorId",
      COALESCE(cn."againstInvoiceNumber", '') AS "againstInvoiceNumber",
      (cn."totalPaise" / 100.0) AS amount,
      (cn."taxPaise" / 100.0) AS "taxAmount",
      COALESCE(cn.reason, '') AS reason,
      COALESCE(cn."issuedAt", cn."createdAt") AS "issuedAt"
    FROM credit_notes cn
    WHERE cn."deletedAt" IS NULL
      AND ${noteInRange('cn')}
      AND (:vendorId::uuid IS NULL OR cn."vendorId" = :vendorId)

    UNION ALL

    SELECT
      'DEBIT'::text AS type,
      dn.number AS "noteNumber",
      dn."orderId"::text AS "orderId",
      COALESCE(dn."subOrderId"::text, '') AS "subOrderId",
      COALESCE(dn."vendorId"::text, '') AS "vendorId",
      COALESCE(dn."againstInvoiceNumber", '') AS "againstInvoiceNumber",
      (dn."netClawbackPaise" / 100.0) AS amount,
      0::numeric AS "taxAmount",
      COALESCE(dn.reason, '') AS reason,
      COALESCE(dn."issuedAt", dn."createdAt") AS "issuedAt"
    FROM debit_notes dn
    WHERE dn."deletedAt" IS NULL
      AND ${noteInRange('dn')}
      AND (:vendorId::uuid IS NULL OR dn."vendorId" = :vendorId)
  `;
}

function mapCreditDebitNoteRow(row: Record<string, unknown>) {
  return {
    type: String(row.type ?? ''),
    noteNumber: String(row.noteNumber ?? ''),
    orderId: String(row.orderId ?? ''),
    subOrderId: String(row.subOrderId ?? ''),
    vendorId: String(row.vendorId ?? ''),
    againstInvoiceNumber: String(row.againstInvoiceNumber ?? ''),
    amount: Math.round(Number(row.amount ?? 0) * 100) / 100,
    taxAmount: Math.round(Number(row.taxAmount ?? 0) * 100) / 100,
    reason: String(row.reason ?? ''),
    issuedAt: row.issuedAt,
  };
}

async function creditDebitNoteRegisterExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: creditDebitNoteSelectSql(),
    order: CREDIT_DEBIT_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapCreditDebitNoteRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

const VENDOR_SETTLEMENT_KEYSET: KeysetOrderCol[] = [
  { column: 'vendorName', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
];

const AUDIT_LOG_KEYSET: KeysetOrderCol[] = [
  { column: 'createdAt', direction: 'DESC' },
  { column: 'id', direction: 'DESC' },
];

function vendorSettlementSelectSql(): string {
  const netPaiseExpr = `CASE
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

  return `
    WITH ledger_agg AS (
      SELECT
        cl."vendorId" AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        SUM(CASE WHEN cl.status = '${COMMISSION_STATUS.PENDING}' THEN ${netPaiseExpr} ELSE 0 END)::bigint AS "pendingNetPaise",
        SUM(CASE WHEN cl.status = '${COMMISSION_STATUS.SETTLED}' THEN ${netPaiseExpr} ELSE 0 END)::bigint AS "settledNetPaise"
      FROM commission_ledgers cl
      INNER JOIN vendors v ON v.id = cl."vendorId" AND v."deletedAt" IS NULL
      WHERE cl."deletedAt" IS NULL
        AND cl."createdAt" BETWEEN :from AND :to
        AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
        AND (:vendorId::uuid IS NULL OR cl."vendorId" = :vendorId)
      GROUP BY cl."vendorId"
    ),
    payout_agg AS (
      SELECT
        p."vendorId" AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        SUM(p.amount::numeric) AS "payoutAmount",
        SUM(CASE WHEN p.status IN ('PENDING', 'PROCESSING') THEN p.amount::numeric ELSE 0 END) AS "payoutPending",
        SUM(CASE WHEN p.status = 'PAID' THEN p.amount::numeric ELSE 0 END) AS "payoutPaid",
        string_agg(DISTINCT p.status::text, ',') AS "payoutStatus"
      FROM payouts p
      INNER JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      WHERE p."deletedAt" IS NULL
        AND p."createdAt" BETWEEN :from AND :to
        AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId)
        AND (:status::text IS NULL OR p.status::text = :status)
      GROUP BY p."vendorId"
    )
    SELECT
      COALESCE(l."vendorId", p."vendorId")::text AS "vendorId",
      COALESCE(l."vendorName", p."vendorName") AS "vendorName",
      COALESCE(l."pendingNetPaise", 0)::bigint AS "pendingNetPaise",
      COALESCE(l."settledNetPaise", 0)::bigint AS "settledNetPaise",
      COALESCE(p."payoutAmount", 0) AS "payoutAmount",
      COALESCE(p."payoutPending", 0) AS "payoutPending",
      COALESCE(p."payoutPaid", 0) AS "payoutPaid",
      COALESCE(p."payoutStatus", 'NONE') AS "payoutStatus"
    FROM ledger_agg l
    FULL OUTER JOIN payout_agg p ON l."vendorId" = p."vendorId"
  `;
}

function mapVendorSettlementRow(row: Record<string, unknown>) {
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    pendingNet: fromPaise(Number(row.pendingNetPaise ?? 0)),
    settledNet: fromPaise(Number(row.settledNetPaise ?? 0)),
    payoutAmount: Math.round(Number(row.payoutAmount ?? 0) * 100) / 100,
    payoutPending: Math.round(Number(row.payoutPending ?? 0) * 100) / 100,
    payoutPaid: Math.round(Number(row.payoutPaid ?? 0) * 100) / 100,
    payoutStatus: String(row.payoutStatus || 'NONE'),
  };
}

async function vendorSettlement(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: vendorSettlementSelectSql(),
    orderBySql: `"vendorName" ASC, "vendorId" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapVendorSettlementRow,
  });
}

async function vendorSettlementExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: vendorSettlementSelectSql(),
    order: VENDOR_SETTLEMENT_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapVendorSettlementRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function commissionRevenue(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: commissionRevenueSelectSql(),
    orderBySql: `"vendorName" ASC, period ASC, "categorySort" ASC NULLS LAST`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapCommissionRevenueRow,
  });
}

const COMMISSION_REVENUE_KEYSET: KeysetOrderCol[] = [
  { column: 'vendorName', direction: 'ASC' },
  { column: 'period', direction: 'ASC' },
  { column: 'categorySort', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
];

function commissionRevenueSelectSql(): string {
  const commissionExpr = sqlFrozenPaise('cl', 'commissionAmountPaise', 'commissionAmount');
  const periodExpr = `to_char(cl."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM')`;
  return `
    SELECT
      cl."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      cat."categoryId"::text AS "categoryId",
      COALESCE(cat."categoryId"::text, '') AS "categorySort",
      ${periodExpr} AS period,
      SUM(${commissionExpr})::bigint AS "commissionPaise"
    FROM commission_ledgers cl
    INNER JOIN vendors v ON v.id = cl."vendorId" AND v."deletedAt" IS NULL
    LEFT JOIN LATERAL (
      SELECT p."categoryId"
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
      INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
      WHERE oi."subOrderId" = cl."subOrderId"
        AND oi."deletedAt" IS NULL
      ORDER BY oi.quantity DESC, oi."createdAt" ASC
      LIMIT 1
    ) cat ON true
    WHERE cl."deletedAt" IS NULL
      AND cl."createdAt" BETWEEN :from AND :to
      AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
      AND (:vendorId::uuid IS NULL OR cl."vendorId" = :vendorId)
      AND (:categoryId::uuid IS NULL OR cat."categoryId" = :categoryId)
    GROUP BY cl."vendorId", cat."categoryId", ${periodExpr}
  `;
}

function mapCommissionRevenueRow(row: Record<string, unknown>) {
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    categoryId: row.categoryId == null ? null : String(row.categoryId),
    period: String(row.period ?? ''),
    commission: fromPaise(Number(row.commissionPaise ?? 0)),
  };
}

async function commissionRevenueExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: commissionRevenueSelectSql(),
    order: COMMISSION_REVENUE_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapCommissionRevenueRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function couponDiscountCost(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: couponDiscountSelectSql(),
    orderBySql: `"vendorName" ASC, "discountBearer" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapCouponDiscountRow,
  });
}

function couponDiscountSelectSql(): string {
  const discountExpr = sqlFrozenPaise('cl', 'discountAmountPaise', 'discountAmount');
  const bearerExpr = `CASE
    WHEN cl."discountBearer" = '${DISCOUNT_BEARER.VENDOR}' THEN '${DISCOUNT_BEARER.VENDOR}'
    ELSE '${DISCOUNT_BEARER.PLATFORM}'
  END`;
  return `
    SELECT
      cl."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      ${bearerExpr} AS "discountBearer",
      SUM(${discountExpr})::bigint AS "discountPaise"
    FROM commission_ledgers cl
    INNER JOIN vendors v ON v.id = cl."vendorId" AND v."deletedAt" IS NULL
    WHERE cl."deletedAt" IS NULL
      AND cl."createdAt" BETWEEN :from AND :to
      AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
      AND (:vendorId::uuid IS NULL OR cl."vendorId" = :vendorId)
      AND (${discountExpr}) > 0
    GROUP BY cl."vendorId", ${bearerExpr}
  `;
}

function mapCouponDiscountRow(row: Record<string, unknown>) {
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    discountBearer: String(row.discountBearer ?? DISCOUNT_BEARER.PLATFORM),
    discountAmount: fromPaise(Number(row.discountPaise ?? 0)),
  };
}

const COUPON_DISCOUNT_KEYSET: KeysetOrderCol[] = [
  { column: 'vendorName', direction: 'ASC' },
  { column: 'discountBearer', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
];

async function couponDiscountCostExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: couponDiscountSelectSql(),
    order: COUPON_DISCOUNT_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapCouponDiscountRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function gmvSales(filters: ReportFilters) {
  assertReportRange(filters);
  const replacements = sqlReplacements(filters);

  if (filters.categoryId) {
    const taxableExpr = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');
    const selectSql = `
      SELECT
        s."vendorId"::text AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        p."categoryId"::text AS "categoryId",
        SUM(${taxableExpr})::bigint AS "gmvPaise"
      FROM order_items oi
      INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
      INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
      LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
      WHERE oi."deletedAt" IS NULL
        AND o."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        AND p."categoryId" = :categoryId
        AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      GROUP BY s."vendorId", p."categoryId"
    `;

    return pagedSqlQuery({
      selectSql,
      orderBySql: `"gmvPaise" DESC, "vendorId" ASC`,
      replacements,
      filters,
      mapRow: (row) => ({
        vendorId: String(row.vendorId ?? 'UNKNOWN'),
        vendorName: String(row.vendorName ?? row.vendorId ?? 'UNKNOWN'),
        categoryId: String(row.categoryId ?? filters.categoryId),
        gmv: fromPaise(Number(row.gmvPaise ?? 0)),
      }),
    });
  }

  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise', 'subtotal');
  const selectSql = `
    SELECT
      s."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      NULL::text AS "categoryId",
      SUM(${subtotalExpr})::bigint AS "gmvPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
    GROUP BY s."vendorId"
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"gmvPaise" DESC, "vendorId" ASC`,
    replacements,
    filters,
    mapRow: (row) => ({
      vendorId: String(row.vendorId ?? 'UNKNOWN'),
      vendorName: String(row.vendorName ?? row.vendorId ?? 'UNKNOWN'),
      categoryId: null,
      gmv: fromPaise(Number(row.gmvPaise ?? 0)),
    }),
  });
}

const GMV_KEYSET: KeysetOrderCol[] = [
  { column: 'gmvPaise', direction: 'DESC' },
  { column: 'vendorId', direction: 'ASC' },
];

const GMV_CATEGORY_KEYSET: KeysetOrderCol[] = [
  { column: 'gmvPaise', direction: 'DESC' },
  { column: 'vendorId', direction: 'ASC' },
  { column: 'categoryId', direction: 'ASC' },
];

async function gmvSalesExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const replacements = sqlReplacements(filters);
  if (filters.categoryId) {
    const taxableExpr = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');
    const selectSql = `
      SELECT
        s."vendorId"::text AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        p."categoryId"::text AS "categoryId",
        SUM(${taxableExpr})::bigint AS "gmvPaise"
      FROM order_items oi
      INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
      INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
      LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
      WHERE oi."deletedAt" IS NULL
        AND o."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        AND p."categoryId" = :categoryId
        AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      GROUP BY s."vendorId", p."categoryId"
    `;
    const page = await keysetSqlQuery({
      selectSql,
      order: GMV_CATEGORY_KEYSET,
      replacements,
      limit,
      cursor,
      mapRow: (row) => ({
        vendorId: String(row.vendorId ?? 'UNKNOWN'),
        vendorName: String(row.vendorName ?? row.vendorId ?? 'UNKNOWN'),
        categoryId: String(row.categoryId ?? filters.categoryId),
        gmv: fromPaise(Number(row.gmvPaise ?? 0)),
      }),
    });
    return { rows: page.rows, nextCursor: page.nextCursor };
  }

  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise', 'subtotal');
  const selectSql = `
    SELECT
      s."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      NULL::text AS "categoryId",
      SUM(${subtotalExpr})::bigint AS "gmvPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
    WHERE s."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
    GROUP BY s."vendorId"
  `;
  const page = await keysetSqlQuery({
    selectSql,
    order: GMV_KEYSET,
    replacements,
    limit,
    cursor,
    mapRow: (row) => ({
      vendorId: String(row.vendorId ?? 'UNKNOWN'),
      vendorName: String(row.vendorName ?? row.vendorId ?? 'UNKNOWN'),
      categoryId: null,
      gmv: fromPaise(Number(row.gmvPaise ?? 0)),
    }),
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function auditLogReport(filters: ReportFilters) {
  assertReportRange(filters);
  const where: Record<string, unknown> = {
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.action = filters.status;

  const { rows, total } = await pagedFindAndCount(
    AuditLog,
    {
      where,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map(mapAuditLogRow),
    total,
  };
}

function mapAuditLogRow(log: {
  createdAt: Date;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
}) {
  return {
    createdAt: log.createdAt,
    actorId: log.actorId,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    metadata: log.metadata ?? {},
  };
}

async function auditLogExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const actionFilter = filters.status ? `AND al.action = :status` : '';
  const selectSql = `
    SELECT
      al.id AS id,
      al."createdAt" AS "createdAt",
      al."actorId" AS "actorId",
      al.action AS action,
      al."entityType" AS "entityType",
      al."entityId" AS "entityId",
      al.metadata AS metadata
    FROM audit_logs al
    WHERE al."deletedAt" IS NULL
      AND al."createdAt" BETWEEN :from AND :to
      ${actionFilter}
  `;
  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  if (filters.status) replacements.status = filters.status;

  const page = await keysetSqlQuery({
    selectSql,
    order: AUDIT_LOG_KEYSET,
    replacements,
    limit,
    cursor,
    mapRow: (row) => ({
      createdAt: row.createdAt as Date,
      actorId: row.actorId as string | null,
      action: String(row.action ?? ''),
      entityType: String(row.entityType ?? ''),
      entityId: row.entityId as string | null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }),
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

export const adminFinanceReports: ReportDefinition[] = [
  {
    type: 'gst-tcs-summary',
    labelKey: 'reportGstTcsSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'groupType', labelKey: 'groupType' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'state', labelKey: 'state' },
      { key: 'period', labelKey: 'period' },
      { key: 'section', labelKey: 'section' },
      { key: 'entryType', labelKey: 'entryType' },
      { key: 'taxableValue', labelKey: 'taxableValue', format: 'currency' },
      { key: 'tcsCgst', labelKey: 'tcsCgst', format: 'currency' },
      { key: 'tcsSgst', labelKey: 'tcsSgst', format: 'currency' },
      { key: 'tcsIgst', labelKey: 'tcsIgst', format: 'currency' },
      { key: 'tcsTotal', labelKey: 'tcsTotal', format: 'currency' },
    ],
    query: gstTcsSummary,
    exportQuery: gstTcsExport,
  },
  {
    type: 'tds-194o-summary',
    labelKey: 'reportTds194oSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'period', labelKey: 'period' },
      { key: 'section', labelKey: 'section' },
      { key: 'grossTaxable', labelKey: 'grossTaxable', format: 'currency' },
      { key: 'tdsAmount', labelKey: 'tdsAmount', format: 'currency' },
    ],
    query: tds194oSummary,
    exportQuery: tds194oExport,
  },
  {
    type: 'hsn-sales-summary',
    labelKey: 'reportHsnSalesSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'hsnCode', labelKey: 'hsnCode' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'tax', labelKey: 'tax', format: 'currency' },
    ],
    query: hsnSalesSummary,
    exportQuery: hsnSalesExport,
  },
  {
    type: 'state-tax-collection',
    labelKey: 'reportStateTaxCollection',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'state', labelKey: 'state' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
      { key: 'taxTotal', labelKey: 'taxTotal', format: 'currency' },
    ],
    query: stateTaxCollection,
    exportQuery: stateTaxExport,
  },
  {
    type: 'reconciliation',
    labelKey: 'reportReconciliation',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'customerPayments', labelKey: 'customerPayments', format: 'currency' },
      { key: 'vendorNetPayouts', labelKey: 'vendorNetPayouts', format: 'currency' },
      { key: 'platformCommission', labelKey: 'platformCommission', format: 'currency' },
      { key: 'taxCollected', labelKey: 'taxCollected', format: 'currency' },
      { key: 'tcsCollected', labelKey: 'tcsCollected', format: 'currency' },
      { key: 'shippingCollected', labelKey: 'shippingCollected', format: 'currency' },
      { key: 'refundsToCustomer', labelKey: 'refundsToCustomer', format: 'currency' },
      { key: 'accountedTotal', labelKey: 'accountedTotal', format: 'currency' },
      { key: 'difference', labelKey: 'difference', format: 'currency' },
      { key: 'status', labelKey: 'status' },
    ],
    query: reconciliation,
  },
  {
    type: 'credit-debit-note-register',
    labelKey: 'reportCreditDebitNoteRegister',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'type', labelKey: 'type' },
      { key: 'noteNumber', labelKey: 'noteNumber' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'againstInvoiceNumber', labelKey: 'againstInvoiceNumber' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
      { key: 'taxAmount', labelKey: 'taxAmount', format: 'currency' },
      { key: 'reason', labelKey: 'reason' },
      { key: 'issuedAt', labelKey: 'issuedAt', format: 'date' },
    ],
    query: creditDebitNoteRegister,
    exportQuery: creditDebitNoteRegisterExport,
  },
  {
    type: 'vendor-settlement',
    labelKey: 'reportVendorSettlement',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'pendingNet', labelKey: 'pendingNet', format: 'currency' },
      { key: 'settledNet', labelKey: 'settledNet', format: 'currency' },
      { key: 'payoutAmount', labelKey: 'payoutAmount', format: 'currency' },
      { key: 'payoutPending', labelKey: 'payoutPending', format: 'currency' },
      { key: 'payoutPaid', labelKey: 'payoutPaid', format: 'currency' },
      { key: 'payoutStatus', labelKey: 'payoutStatus' },
    ],
    query: vendorSettlement,
    exportQuery: vendorSettlementExport,
  },
  {
    type: 'commission-revenue',
    labelKey: 'reportCommissionRevenue',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'categoryId', labelKey: 'categoryId' },
      { key: 'period', labelKey: 'period' },
      { key: 'commission', labelKey: 'commission', format: 'currency' },
    ],
    query: commissionRevenue,
    exportQuery: commissionRevenueExport,
  },
  {
    type: 'coupon-discount-cost',
    labelKey: 'reportCouponDiscountCost',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'discountBearer', labelKey: 'discountBearer' },
      { key: 'discountAmount', labelKey: 'discountAmount', format: 'currency' },
    ],
    query: couponDiscountCost,
    exportQuery: couponDiscountCostExport,
  },
  {
    type: 'gmv-sales',
    labelKey: 'reportGmvSales',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'categoryId', labelKey: 'categoryId' },
      { key: 'gmv', labelKey: 'gmv', format: 'currency' },
    ],
    query: gmvSales,
    exportQuery: gmvSalesExport,
  },
  {
    type: 'audit-log',
    labelKey: 'reportAuditLog',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.AUDIT_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'actorId', labelKey: 'actorId' },
      { key: 'action', labelKey: 'action' },
      { key: 'entityType', labelKey: 'entityType' },
      { key: 'entityId', labelKey: 'entityId' },
      { key: 'metadata', labelKey: 'metadata' },
    ],
    query: auditLogReport,
    exportQuery: auditLogExport,
  },
];
