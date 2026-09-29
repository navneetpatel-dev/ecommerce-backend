import {
  assertReportRange,
  fromPaise,
  dateBetween,
  TCS_LEDGER_ORDER_SQL,
  pagedFindAndCount,
  pagedSqlQuery,
  computeReconciliationSummary,
  sqlFrozenPaise,
  COMMISSION_STATUS,
} from '../engine/queryHelpers';
import {
  GMV_SUB_ORDER_SQL,
  PAID_OR_COD_ORDER_SQL,
  sqlLedgerOnPaidOrder,
  sqlLedgerPlatformDiscountPaise,
  sqlLedgerPlatformGstPaise,
  sqlLedgerVendorDiscountPaise,
  sqlLineSubtotalPaise,
} from '@modules/pricing/frozenMoneySql';
import { COMMISSION_REFERENCE_TYPE } from '@core/constants/statuses';
import { IST_TIME_ZONE } from '@modules/pricing/istCalendar';
import { roundMoney } from '@modules/pricing/money';
import { vendorPayablePaise } from '../engine/vendorPayable';
import { PART_RETURN_DESCRIPTION_PREFIX } from '@modules/wallet/walletOrderRollback';
import { gstDocumentReplacements, scopedGstDocumentLinesSql } from '../engine/gstDocumentsSql';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { AuditLog } from '@database/models/auditLog.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { createSingleShotExportQuery } from '../engine/export/createOffsetExportQuery';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { sequelize } from '@database/models';

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
      AND ${TCS_LEDGER_ORDER_SQL}
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
      AND ${TCS_LEDGER_ORDER_SQL}
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

async function gstReplacements(filters: ReportFilters): Promise<Record<string, unknown>> {
  return { ...sqlReplacements(filters), ...(await gstDocumentReplacements()) };
}

async function hsnSalesSummary(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: hsnSalesSelectSql(),
    orderBySql: `"supplierGstin" ASC, "hsnCode" ASC, "gstRate" ASC`,
    replacements: await gstReplacements(filters),
    filters,
    mapRow: mapHsnSalesRow,
  });
}

async function stateTaxCollection(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: stateTaxSelectSql(),
    orderBySql: `state ASC`,
    replacements: await gstReplacements(filters),
    filters,
    mapRow: mapStateTaxRow,
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

/**
 * HSN / SAC summary (GSTR-1 table 12) of the documents issued in the range: per
 * supplier, HSN and GST rate, invoices less credit notes, with the tax split. Read from
 * the invoices as issued, so a return counts once — in its credit note's month.
 */
function hsnSalesSelectSql(): string {
  return `
    SELECT
      "supplierName",
      "supplierGstin",
      COALESCE(NULLIF("hsnCode", ''), 'UNKNOWN') AS "hsnCode",
      COALESCE("gstRate", 0) AS "gstRate",
      SUM(qty)::int AS qty,
      SUM("taxablePaise")::bigint AS "taxablePaise",
      SUM("cgstPaise")::bigint AS "cgstPaise",
      SUM("sgstPaise")::bigint AS "sgstPaise",
      SUM("igstPaise")::bigint AS "igstPaise"
    FROM (${scopedGstDocumentLinesSql()}) d
    WHERE (:categoryId::uuid IS NULL OR d."categoryId" = :categoryId)
    GROUP BY "supplierName", "supplierGstin", COALESCE(NULLIF("hsnCode", ''), 'UNKNOWN'), COALESCE("gstRate", 0)
  `;
}

function mapHsnSalesRow(row: Record<string, unknown>) {
  const cgst = Number(row.cgstPaise ?? 0);
  const sgst = Number(row.sgstPaise ?? 0);
  const igst = Number(row.igstPaise ?? 0);
  return {
    supplierName: String(row.supplierName ?? ''),
    supplierGstin: String(row.supplierGstin ?? ''),
    hsnCode: String(row.hsnCode ?? 'UNKNOWN'),
    gstRate: Number(row.gstRate ?? 0),
    qty: Number(row.qty ?? 0),
    taxable: fromPaise(Number(row.taxablePaise ?? 0)),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    tax: fromPaise(cgst + sgst + igst),
  };
}

const HSN_SALES_KEYSET: KeysetOrderCol[] = [
  { column: 'supplierGstin', direction: 'ASC' },
  { column: 'hsnCode', direction: 'ASC' },
  { column: 'gstRate', direction: 'ASC' },
];

async function hsnSalesExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  const page = await keysetSqlQuery({
    selectSql: hsnSalesSelectSql(),
    order: HSN_SALES_KEYSET,
    replacements: await gstReplacements(filters),
    limit,
    cursor,
    mapRow: mapHsnSalesRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

/**
 * GST by place of supply (customer state) on the documents issued in the range:
 * invoices less credit notes, every supplier (a vendor filter keeps that vendor's).
 */
function stateTaxSelectSql(): string {
  return `
    SELECT
      state,
      SUM("cgstPaise")::bigint AS "cgstPaise",
      SUM("sgstPaise")::bigint AS "sgstPaise",
      SUM("igstPaise")::bigint AS "igstPaise",
      SUM("cgstPaise" + "sgstPaise" + "igstPaise")::bigint AS "taxTotalPaise"
    FROM (${scopedGstDocumentLinesSql()}) d
    GROUP BY state
  `;
}

function mapStateTaxRow(row: Record<string, unknown>) {
  return {
    state: String(row.state ?? 'UNKNOWN'),
    cgst: fromPaise(Number(row.cgstPaise ?? 0)),
    sgst: fromPaise(Number(row.sgstPaise ?? 0)),
    igst: fromPaise(Number(row.igstPaise ?? 0)),
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
    replacements: await gstReplacements(filters),
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

  // Wallet money in and out over the period. Recharges count net of the ones refunded
  // (e.g. over the wallet limit); gift cards count when redeemed into a wallet.
  // Checkout spend counts COD orders too (not only paid online ones), less the wallet
  // share given back when a part was cancelled or came back undelivered.
  const [walletRows] = await sequelize.query(
    `
    SELECT
      COALESCE((
        SELECT SUM(wro."amountInr")::numeric
        FROM wallet_recharge_orders wro
        WHERE wro.status = 'PAID'
          AND wro."paidAt" BETWEEN :from AND :to
          AND wro."deletedAt" IS NULL
          AND wro."refundStatus"::text NOT IN ('INITIATED', 'COMPLETED')
      ), 0) AS "walletRechargeInflow",
      COALESCE((
        SELECT SUM(g.amount)::numeric
        FROM gift_cards g
        WHERE g."redeemedAt" BETWEEN :from AND :to
          AND g."deletedAt" IS NULL
      ), 0) AS "giftCardRedemptionInflow",
      COALESCE((
        SELECT SUM(o."walletAmountUsed")::numeric
        FROM orders o
        WHERE o."createdAt" BETWEEN :from AND :to
          AND o."deletedAt" IS NULL
          AND ${PAID_OR_COD_ORDER_SQL}
      ), 0)
      - COALESCE((
        SELECT SUM(wl.amount)::numeric
        FROM wallet_ledgers wl
        INNER JOIN orders o ON o.id::text = wl."referenceId"::text
        WHERE wl."deletedAt" IS NULL
          AND wl.type = 'CREDIT'
          AND wl.description LIKE :partReturnPrefix
          AND o."createdAt" BETWEEN :from AND :to
          AND o."deletedAt" IS NULL
          AND ${PAID_OR_COD_ORDER_SQL}
      ), 0) AS "walletPointsRedeemedAtCheckout"
    `,
    {
      replacements: {
        from: filters.from,
        to: filters.to,
        partReturnPrefix: `${PART_RETURN_DESCRIPTION_PREFIX}%`,
      },
    },
  );
  const walletMeta = (walletRows as Array<Record<string, number>>)[0] ?? {};
  const walletRechargeInflow = Number(walletMeta.walletRechargeInflow ?? 0);
  const giftCardRedemptionInflow = Number(walletMeta.giftCardRedemptionInflow ?? 0);
  const walletPointsRedeemedAtCheckout = Number(walletMeta.walletPointsRedeemedAtCheckout ?? 0);

  const differencePaise = summary.customerPaymentsPaise - summary.accountedPaise;
  const balanced = differencePaise === 0;
  const row = {
    customerPayments: fromPaise(summary.customerPaymentsPaise),
    vendorNetPayouts: fromPaise(summary.vendorNetPayoutsPaise),
    platformFundedDiscount: fromPaise(summary.platformFundedDiscountPaise),
    platformCommission: fromPaise(summary.platformCommissionPaise),
    taxCollected: fromPaise(summary.taxCollectedPaise),
    tcsCollected: fromPaise(summary.tcsCollectedPaise),
    platformGoodsSales: fromPaise(summary.platformGoodsPaise),
    shippingCollected: fromPaise(summary.shippingCollectedPaise),
    shippingRefunded: fromPaise(summary.shippingRefundedPaise),
    returnFeesKept: fromPaise(summary.returnFeesKeptPaise),
    giftWrapCollected: fromPaise(summary.giftWrapPaise),
    refundsToCustomer: fromPaise(summary.refundsPaise),
    walletRechargeInflow,
    giftCardRedemptionInflow,
    walletPointsRedeemedAtCheckout,
    accountedTotal: fromPaise(summary.accountedPaise),
    difference: fromPaise(differencePaise),
    status: balanced ? 'BALANCED' : 'MISMATCH',
  };
  const meta = {
    ...row,
    balanced,
    error: balanced ? null : ERROR_MESSAGES.REPORT_RECONCILIATION_MISMATCH,
    from: filters.from,
    to: filters.to,
    /** Order consideration GMV; PG cash ≈ razorpayAmountPaid; wallet redeem is separate. */
    note:
      'customerPayments = vendorNetPayouts − platformFundedDiscount + platformCommission + tcsCollected + platformGoodsSales + shippingCollected − shippingRefunded + returnFeesKept + giftWrapCollected + refundsToCustomer. GST is inside vendor net payouts (taxCollected is shown, not added). customerPayments is order consideration (not PG cash); walletPointsRedeemedAtCheckout is funding, not part of the equation.',
  };
  return { rows: [row], total: 1, meta };
}

async function creditDebitNoteRegister(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: creditDebitNoteSelectSql(),
    orderBySql: `"issuedAt" DESC, "noteNumber" DESC`,
    replacements: await gstReplacements(filters),
    filters,
    mapRow: mapCreditDebitNoteRow,
  });
}

const CREDIT_DEBIT_KEYSET: KeysetOrderCol[] = [
  { column: 'issuedAt', direction: 'DESC' },
  { column: 'noteNumber', direction: 'DESC' },
];

/**
 * Every credit note issued in the range (returns, RTOs, the platform's shipping and
 * gift-wrap refunds, commission credit notes), with its taxable value, tax split, place
 * of supply and recipient GSTIN — plus the vendor debit notes (recoveries, not GST
 * documents: no tax). Amounts are shown positive.
 */
function creditDebitNoteSelectSql(): string {
  return `
    SELECT
      'CREDIT'::text AS type,
      d."documentNumber" AS "noteNumber",
      COALESCE(d."orderId"::text, '') AS "orderId",
      COALESCE(d."subOrderId"::text, '') AS "subOrderId",
      COALESCE(d."supplierVendorId", d."recipientVendorId")::text AS "vendorId",
      MAX(d."supplierName") AS "supplierName",
      COALESCE(MAX(d."againstInvoiceNumber"), '') AS "againstInvoiceNumber",
      COALESCE(MAX(d."recipientGstin"), '') AS "recipientGstin",
      MAX(d.state) AS "placeOfSupplyState",
      -SUM(d."taxablePaise")::bigint AS "taxablePaise",
      -SUM(d."cgstPaise")::bigint AS "cgstPaise",
      -SUM(d."sgstPaise")::bigint AS "sgstPaise",
      -SUM(d."igstPaise")::bigint AS "igstPaise",
      COALESCE(MAX(d.reason), '') AS reason,
      d."documentDate" AS "issuedAt"
    FROM (${scopedGstDocumentLinesSql()}) d
    WHERE d."docType" = 'CREDIT_NOTE'
    GROUP BY d."documentNumber", d."documentDate", d."orderId", d."subOrderId",
             d."supplierVendorId", d."recipientVendorId"

    UNION ALL

    SELECT
      'DEBIT'::text,
      dn.number,
      dn."orderId"::text,
      COALESCE(dn."subOrderId"::text, ''),
      COALESCE(dn."vendorId"::text, ''),
      COALESCE(v."businessName", ''),
      COALESCE(dn."againstInvoiceNumber", ''),
      COALESCE(NULLIF(v."gstNumber", ''), ''),
      COALESCE(v.state, ''),
      dn."netClawbackPaise"::bigint,
      0::bigint,
      0::bigint,
      0::bigint,
      COALESCE(dn.reason, ''),
      COALESCE(dn."issuedAt", dn."createdAt")
    FROM debit_notes dn
    LEFT JOIN vendors v ON v.id = dn."vendorId"
    WHERE dn."deletedAt" IS NULL
      AND COALESCE(dn."issuedAt", dn."createdAt") BETWEEN :from AND :to
      AND (:vendorId::uuid IS NULL OR dn."vendorId" = :vendorId)
  `;
}

function mapCreditDebitNoteRow(row: Record<string, unknown>) {
  const taxable = Number(row.taxablePaise ?? 0);
  const cgst = Number(row.cgstPaise ?? 0);
  const sgst = Number(row.sgstPaise ?? 0);
  const igst = Number(row.igstPaise ?? 0);
  return {
    type: String(row.type ?? ''),
    noteNumber: String(row.noteNumber ?? ''),
    orderId: String(row.orderId ?? ''),
    subOrderId: String(row.subOrderId ?? ''),
    vendorId: String(row.vendorId ?? ''),
    supplierName: String(row.supplierName ?? ''),
    againstInvoiceNumber: String(row.againstInvoiceNumber ?? ''),
    recipientGstin: String(row.recipientGstin ?? ''),
    placeOfSupplyState: String(row.placeOfSupplyState ?? ''),
    taxable: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    taxAmount: fromPaise(cgst + sgst + igst),
    amount: fromPaise(taxable + cgst + sgst + igst),
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
    replacements: await gstReplacements(filters),
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

/**
 * Vendor settlement for ledgers created (and payouts run) in the range. The ledger side
 * lists the vendors; their pending and settled payables are the payout run's own
 * breakdown (after 194-O TDS and GST on commission), filled in by
 * `withVendorPayables`. Payouts: every run that did not fail, what is still to be
 * paid, what was paid, and failed runs on their own (a failed run is retried by a
 * later one, so counting both would pay the vendor twice on paper).
 */
function vendorSettlementSelectSql(): string {
  return `
    WITH ledger_agg AS (
      SELECT cl."vendorId" AS "vendorId", MAX(v."businessName") AS "vendorName"
      FROM commission_ledgers cl
      INNER JOIN vendors v ON v.id = cl."vendorId" AND v."deletedAt" IS NULL
      WHERE cl."deletedAt" IS NULL
        AND cl."createdAt" BETWEEN :from AND :to
        AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
        AND ${sqlLedgerOnPaidOrder('cl')}
        AND (:vendorId::uuid IS NULL OR cl."vendorId" = :vendorId)
      GROUP BY cl."vendorId"
    ),
    payout_agg AS (
      SELECT
        p."vendorId" AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        SUM(CASE WHEN p.status <> 'FAILED' THEN p.amount::numeric ELSE 0 END) AS "payoutAmount",
        SUM(CASE WHEN p.status IN ('PENDING', 'PROCESSING') THEN p.amount::numeric ELSE 0 END) AS "payoutPending",
        SUM(CASE WHEN p.status = 'PAID' THEN p.amount::numeric ELSE 0 END) AS "payoutPaid",
        SUM(CASE WHEN p.status = 'FAILED' THEN p.amount::numeric ELSE 0 END) AS "payoutFailed",
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
      COALESCE(p."payoutAmount", 0) AS "payoutAmount",
      COALESCE(p."payoutPending", 0) AS "payoutPending",
      COALESCE(p."payoutPaid", 0) AS "payoutPaid",
      COALESCE(p."payoutFailed", 0) AS "payoutFailed",
      COALESCE(p."payoutStatus", 'NONE') AS "payoutStatus"
    FROM ledger_agg l
    FULL OUTER JOIN payout_agg p ON l."vendorId" = p."vendorId"
  `;
}

function mapVendorSettlementRow(row: Record<string, unknown>) {
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    pendingNet: 0,
    settledNet: 0,
    payoutAmount: roundMoney(row.payoutAmount),
    payoutPending: roundMoney(row.payoutPending),
    payoutPaid: roundMoney(row.payoutPaid),
    payoutFailed: roundMoney(row.payoutFailed),
    payoutStatus: String(row.payoutStatus || 'NONE'),
  };
}

/** Fill each row's pending and settled payables from the payout breakdown. */
async function withVendorPayables(
  rows: Array<Record<string, unknown>>,
  filters: ReportFilters,
): Promise<Array<Record<string, unknown>>> {
  const vendorIds = rows.map((row) => String(row.vendorId)).filter(Boolean);
  const range = { from: filters.from, to: filters.to };
  const [pending, settled] = await Promise.all([
    vendorPayablePaise(vendorIds, { ...range, status: COMMISSION_STATUS.PENDING }),
    vendorPayablePaise(vendorIds, { ...range, status: COMMISSION_STATUS.SETTLED }),
  ]);
  return rows.map((row) => ({
    ...row,
    pendingNet: fromPaise(pending.get(String(row.vendorId)) ?? 0),
    settledNet: fromPaise(settled.get(String(row.vendorId)) ?? 0),
  }));
}

async function vendorSettlement(filters: ReportFilters) {
  assertReportRange(filters);
  const result = await pagedSqlQuery({
    selectSql: vendorSettlementSelectSql(),
    orderBySql: `"vendorName" ASC, "vendorId" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapVendorSettlementRow,
  });
  return { ...result, rows: await withVendorPayables(result.rows, filters) };
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
  return { rows: await withVendorPayables(page.rows, filters), nextCursor: page.nextCursor };
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

/**
 * Commission earned per vendor, category and month (IST): each order line's commission
 * under its own product's category — a part with items from several categories is
 * split between them, not all given to one. Net of returns (the lines carry the
 * commission still earned), only on sales that count (paid or COD, not cancelled or
 * RTO'd), by the month the order was placed.
 */
function commissionRevenueSelectSql(): string {
  const periodExpr = `to_char(o."createdAt" AT TIME ZONE '${IST_TIME_ZONE}', 'YYYY-MM')`;
  return `
    SELECT
      s."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      (COALESCE(oi."categoryId", p."categoryId"))::text AS "categoryId",
      COALESCE((COALESCE(oi."categoryId", p."categoryId"))::text, '') AS "categorySort",
      ${periodExpr} AS period,
      SUM(oi."commissionAmountPaise")::bigint AS "commissionPaise"
    FROM order_items oi
    INNER JOIN sub_orders s ON s.id = oi."subOrderId"
    INNER JOIN orders o ON o.id = s."orderId"
    INNER JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
    LEFT JOIN product_variants pv ON pv.id = oi."variantId"
    LEFT JOIN products p ON p.id = pv."productId"
    WHERE oi."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
      AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      AND (:categoryId::uuid IS NULL OR COALESCE(oi."categoryId", p."categoryId") = :categoryId)
    GROUP BY s."vendorId", COALESCE(oi."categoryId", p."categoryId"), ${periodExpr}
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

/**
 * Section 194C TDS on delivery-agent payouts (agents are contractors): per payout, the
 * agent's PAN, gross earnings, rate, TDS withheld and net paid, with the IST month and
 * financial-year quarter the TDS is deposited and returned (Form 26Q) under. Failed
 * payouts are left out — nothing was paid or withheld.
 */
function deliveryAgentTdsSelectSql(): string {
  const ist = `p."createdAt" AT TIME ZONE '${IST_TIME_ZONE}'`;
  return `
    SELECT
      p.id::text AS "payoutId",
      a.id::text AS "agentId",
      a."fullName" AS "agentName",
      COALESCE(NULLIF(a."bankDetails"->>'pan', ''), '') AS pan,
      to_char(${ist}, 'YYYY-MM') AS period,
      CONCAT(
        'Q', ((EXTRACT(MONTH FROM ${ist})::int + 8) % 12) / 3 + 1,
        ' FY', CASE WHEN EXTRACT(MONTH FROM ${ist}) >= 4
          THEN EXTRACT(YEAR FROM ${ist})::int ELSE EXTRACT(YEAR FROM ${ist})::int - 1 END
      ) AS quarter,
      ROUND(p.amount::numeric * 100)::bigint AS "grossPaise",
      p."tdsRatePercent" AS "tdsRatePercent",
      ROUND(COALESCE(p."tdsAmount", 0)::numeric * 100)::bigint AS "tdsPaise",
      ROUND(p."netAmount"::numeric * 100)::bigint AS "netPaise",
      p.status::text AS status,
      p."paidAt" AS "paidAt",
      p."createdAt" AS "createdAt"
    FROM delivery_agent_payouts p
    INNER JOIN delivery_agents a ON a.id = p."deliveryAgentId"
    WHERE p."deletedAt" IS NULL
      AND p.status::text <> 'FAILED'
      AND p."createdAt" BETWEEN :from AND :to
  `;
}

function mapDeliveryAgentTdsRow(row: Record<string, unknown>) {
  return {
    payoutId: String(row.payoutId ?? ''),
    agentId: String(row.agentId ?? ''),
    agentName: String(row.agentName ?? ''),
    pan: String(row.pan ?? ''),
    period: String(row.period ?? ''),
    quarter: String(row.quarter ?? ''),
    grossAmount: fromPaise(Number(row.grossPaise ?? 0)),
    tdsRatePercent: row.tdsRatePercent == null ? null : Number(row.tdsRatePercent),
    tdsAmount: fromPaise(Number(row.tdsPaise ?? 0)),
    netAmount: fromPaise(Number(row.netPaise ?? 0)),
    status: String(row.status ?? ''),
    paidAt: row.paidAt,
  };
}

const DELIVERY_AGENT_TDS_KEYSET: KeysetOrderCol[] = [
  { column: 'createdAt', direction: 'DESC' },
  { column: 'payoutId', direction: 'DESC' },
];

async function deliveryAgentTds(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: deliveryAgentTdsSelectSql(),
    orderBySql: `"createdAt" DESC, "payoutId" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapDeliveryAgentTdsRow,
  });
}

async function deliveryAgentTdsExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: deliveryAgentTdsSelectSql(),
    order: DELIVERY_AGENT_TDS_KEYSET,
    replacements: sqlReplacements(filters),
    limit,
    cursor,
    mapRow: mapDeliveryAgentTdsRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function couponDiscountCost(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: couponDiscountSelectSql(),
    orderBySql: `"vendorName" ASC, "vendorId" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: mapCouponDiscountRow,
  });
}

/**
 * What coupons cost, per vendor, for ledgers created in the range on sales that count:
 * each ledger's discount split between the vendor and the platform (a stacked order
 * carries both, whatever the ledger's single bearer), the GST the platform pays on its
 * share, and the shipping the coupons waived (the platform's cost). Discounts exclude
 * GST; shipping is as charged. Returns after payout take their share back.
 */
function couponDiscountSelectSql(): string {
  const saleOrReturn = `(cl."referenceType" IS NULL OR cl."referenceType" = '${COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK}')`;
  return `
    SELECT
      cl."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      SUM(${sqlLedgerVendorDiscountPaise('cl')})::bigint AS "vendorDiscountPaise",
      SUM(${sqlLedgerPlatformDiscountPaise('cl')})::bigint AS "platformDiscountPaise",
      SUM(${sqlLedgerPlatformGstPaise('cl')})::bigint AS "platformGstPaise",
      SUM(CASE WHEN cl."referenceType" IS NULL
        THEN COALESCE(s."shippingDiscountAmountPaise", 0) ELSE 0 END)::bigint AS "freeShippingPaise"
    FROM commission_ledgers cl
    INNER JOIN vendors v ON v.id = cl."vendorId" AND v."deletedAt" IS NULL
    LEFT JOIN sub_orders s ON s.id = cl."subOrderId"
    WHERE cl."deletedAt" IS NULL
      AND cl."createdAt" BETWEEN :from AND :to
      AND cl.status <> '${COMMISSION_STATUS.CLAWED_BACK}'
      AND ${saleOrReturn}
      AND ${sqlLedgerOnPaidOrder('cl')}
      AND (:vendorId::uuid IS NULL OR cl."vendorId" = :vendorId)
    GROUP BY cl."vendorId"
    HAVING SUM(cl."discountAmountPaise") <> 0
      OR SUM(CASE WHEN cl."referenceType" IS NULL
        THEN COALESCE(s."shippingDiscountAmountPaise", 0) ELSE 0 END) <> 0
  `;
}

function mapCouponDiscountRow(row: Record<string, unknown>) {
  const platformPaise = Number(row.platformDiscountPaise ?? 0);
  const platformGstPaise = Number(row.platformGstPaise ?? 0);
  const freeShippingPaise = Number(row.freeShippingPaise ?? 0);
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    vendorDiscount: fromPaise(Number(row.vendorDiscountPaise ?? 0)),
    platformDiscount: fromPaise(platformPaise),
    platformDiscountGst: fromPaise(platformGstPaise),
    freeShippingCost: fromPaise(freeShippingPaise),
    platformCouponCost: fromPaise(platformPaise + platformGstPaise + freeShippingPaise),
  };
}

const COUPON_DISCOUNT_KEYSET: KeysetOrderCol[] = [
  { column: 'vendorName', direction: 'ASC' },
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
    const selectSql = `
      SELECT
        s."vendorId"::text AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        (COALESCE(oi."categoryId", p."categoryId"))::text AS "categoryId",
        SUM(${sqlLineSubtotalPaise('oi')})::bigint AS "gmvPaise"
      FROM order_items oi
      INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
      INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
      LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
      WHERE oi."deletedAt" IS NULL
        AND o."createdAt" BETWEEN :from AND :to
        AND ${GMV_SUB_ORDER_SQL}
        AND COALESCE(oi."categoryId", p."categoryId") = :categoryId
        AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      GROUP BY s."vendorId", COALESCE(oi."categoryId", p."categoryId")
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

  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise');
  const selectSql = `
    SELECT
      s."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      NULL::text AS "categoryId",
      SUM(${subtotalExpr})::bigint AS "gmvPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
    WHERE o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
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
    const selectSql = `
      SELECT
        s."vendorId"::text AS "vendorId",
        MAX(v."businessName") AS "vendorName",
        (COALESCE(oi."categoryId", p."categoryId"))::text AS "categoryId",
        SUM(${sqlLineSubtotalPaise('oi')})::bigint AS "gmvPaise"
      FROM order_items oi
      INNER JOIN sub_orders s ON s.id = oi."subOrderId" AND s."deletedAt" IS NULL
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      INNER JOIN product_variants pv ON pv.id = oi."variantId" AND pv."deletedAt" IS NULL
      INNER JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL
      LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
      WHERE oi."deletedAt" IS NULL
        AND o."createdAt" BETWEEN :from AND :to
        AND ${GMV_SUB_ORDER_SQL}
        AND COALESCE(oi."categoryId", p."categoryId") = :categoryId
        AND (:vendorId::uuid IS NULL OR s."vendorId" = :vendorId)
      GROUP BY s."vendorId", COALESCE(oi."categoryId", p."categoryId")
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

  const subtotalExpr = sqlFrozenPaise('s', 'subtotalPaise');
  const selectSql = `
    SELECT
      s."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      NULL::text AS "categoryId",
      SUM(${subtotalExpr})::bigint AS "gmvPaise"
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = s."vendorId" AND v."deletedAt" IS NULL
    WHERE o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
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
      { key: 'supplierName', labelKey: 'supplierName' },
      { key: 'supplierGstin', labelKey: 'supplierGstin' },
      { key: 'hsnCode', labelKey: 'hsnCode' },
      { key: 'gstRate', labelKey: 'gstRate', format: 'number' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
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
      { key: 'platformFundedDiscount', labelKey: 'platformFundedDiscount', format: 'currency' },
      { key: 'platformCommission', labelKey: 'platformCommission', format: 'currency' },
      { key: 'taxCollected', labelKey: 'taxCollected', format: 'currency' },
      { key: 'tcsCollected', labelKey: 'tcsCollected', format: 'currency' },
      { key: 'platformGoodsSales', labelKey: 'platformGoodsSales', format: 'currency' },
      { key: 'shippingCollected', labelKey: 'shippingCollected', format: 'currency' },
      { key: 'shippingRefunded', labelKey: 'shippingRefunded', format: 'currency' },
      { key: 'returnFeesKept', labelKey: 'returnFeesKept', format: 'currency' },
      { key: 'giftWrapCollected', labelKey: 'giftWrapCollected', format: 'currency' },
      { key: 'refundsToCustomer', labelKey: 'refundsToCustomer', format: 'currency' },
      { key: 'walletRechargeInflow', labelKey: 'walletRechargeInflow', format: 'currency' },
      { key: 'giftCardRedemptionInflow', labelKey: 'giftCardRedemptionInflow', format: 'currency' },
      { key: 'walletPointsRedeemedAtCheckout', labelKey: 'walletPointsRedeemedAtCheckout', format: 'points' },
      { key: 'accountedTotal', labelKey: 'accountedTotal', format: 'currency' },
      { key: 'difference', labelKey: 'difference', format: 'currency' },
      { key: 'status', labelKey: 'status' },
    ],
    query: reconciliation,
    exportQuery: createSingleShotExportQuery(reconciliation),
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
      { key: 'supplierName', labelKey: 'supplierName' },
      { key: 'againstInvoiceNumber', labelKey: 'againstInvoiceNumber' },
      { key: 'recipientGstin', labelKey: 'recipientGstin' },
      { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
      { key: 'taxAmount', labelKey: 'taxAmount', format: 'currency' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
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
      { key: 'payoutFailed', labelKey: 'payoutFailed', format: 'currency' },
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
    type: 'delivery-agent-tds-194c',
    labelKey: 'reportDeliveryAgentTds194c',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'agentName', labelKey: 'agentName' },
      { key: 'pan', labelKey: 'pan' },
      { key: 'period', labelKey: 'period' },
      { key: 'quarter', labelKey: 'quarter' },
      { key: 'grossAmount', labelKey: 'agentPayoutGross', format: 'currency' },
      { key: 'tdsRatePercent', labelKey: 'tdsRatePercent', format: 'number' },
      { key: 'tdsAmount', labelKey: 'tdsAmount', format: 'currency' },
      { key: 'netAmount', labelKey: 'agentPayoutNet', format: 'currency' },
      { key: 'status', labelKey: 'status' },
      { key: 'paidAt', labelKey: 'paidAt', format: 'date' },
    ],
    query: deliveryAgentTds,
    exportQuery: deliveryAgentTdsExport,
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
      { key: 'vendorDiscount', labelKey: 'vendorDiscount', format: 'currency' },
      { key: 'platformDiscount', labelKey: 'platformDiscount', format: 'currency' },
      { key: 'platformDiscountGst', labelKey: 'platformDiscountGst', format: 'currency' },
      { key: 'freeShippingCost', labelKey: 'freeShippingCost', format: 'currency' },
      { key: 'platformCouponCost', labelKey: 'platformCouponCost', format: 'currency' },
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
