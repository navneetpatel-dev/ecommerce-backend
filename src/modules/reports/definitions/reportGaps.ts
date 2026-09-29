import {
  GIFT_CARD_STATUS,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { sequelize } from '@database/models';
import { WalletLedger } from '@database/models/walletLedger.model';
import { SupportTicket } from '@database/models/supportTicket.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { NewsletterSubscriber } from '@database/models/newsletterSubscriber.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { createOffsetExportQuery, createSingleShotExportQuery } from '../engine/export/createOffsetExportQuery';
import {
  assertReportRange,
  fromPaise,
  pagedFindAndCount,
  pagedSqlQuery,
  emptyPage,
  dateBetween,
  REPORTABLE_ORDER_SQL,
  TCS_LEDGER_ORDER_SQL,
} from '../engine/queryHelpers';
import { inventoryValuation } from '@modules/pricing/displayMoney';
import { sqlOrderKeptPaymentPaise } from '@modules/pricing/frozenMoneySql';
import { sqlCodCashDuePaise } from '@modules/shipping/codCollection';
import { gstPeriodOf } from '@modules/pricing/gstPeriod';
import {
  gstDocumentLinesSql,
  gstDocumentReplacements,
  scopedGstDocumentLinesSql,
} from '../engine/gstDocumentsSql';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';

function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

function sqlReplacements(filters: ReportFilters): Record<string, unknown> {
  return {
    from: filters.from,
    to: filters.to,
    vendorId: resolveVendorId(filters),
  };
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100;
}

/**
 * The goods tax invoices issued in the range, one row per invoice, as issued (from the
 * frozen snapshot): a return since then does not change the invoice — its credit note
 * carries it (see the credit / debit note register and GSTR-1).
 */
function goodsInvoiceRegisterSql(extraWhere = ''): string {
  return `
    SELECT
      d."subOrderId" AS "subOrderId",
      d."orderId" AS "orderId",
      d."supplierVendorId" AS "vendorId",
      MAX(d."supplierName") AS "vendorName",
      MAX(d."supplierGstin") AS "vendorGstin",
      d."documentNumber" AS "taxInvoiceNumber",
      d."documentDate" AS "taxInvoiceIssuedAt",
      SUM(d."taxablePaise")::bigint AS "taxablePaise",
      SUM(d."cgstPaise")::bigint AS "cgstPaise",
      SUM(d."sgstPaise")::bigint AS "sgstPaise",
      SUM(d."igstPaise")::bigint AS "igstPaise",
      MAX(o."paymentMethod"::text) AS "paymentMethod",
      MAX(o."paymentStatus"::text) AS "paymentStatus",
      COALESCE(MAX(d."recipientGstin"), '') AS "buyerGstin",
      MAX(u.name) AS "buyerName",
      MAX(d.state) AS "placeOfSupplyState"
    FROM (${scopedGstDocumentLinesSql()}) d
    INNER JOIN orders o ON o.id = d."orderId"
    LEFT JOIN users u ON u.id = o."userId"
    WHERE d.source = 'GOODS' AND d."docType" = 'INVOICE'
      ${extraWhere}
    GROUP BY d."subOrderId", d."orderId", d."supplierVendorId", d."documentNumber", d."documentDate"
  `;
}

const TAX_INVOICE_KEYSET: KeysetOrderCol[] = [
  { column: 'taxInvoiceIssuedAt', direction: 'DESC' },
  { column: 'subOrderId', direction: 'DESC' },
];

function mapTaxInvoiceRow(row: Record<string, unknown>) {
  const taxable = Number(row.taxablePaise ?? 0);
  const cgst = Number(row.cgstPaise ?? 0);
  const sgst = Number(row.sgstPaise ?? 0);
  const igst = Number(row.igstPaise ?? 0);
  return {
    subOrderId: row.subOrderId,
    orderId: row.orderId,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    vendorGstin: row.vendorGstin,
    taxInvoiceNumber: row.taxInvoiceNumber,
    taxInvoiceIssuedAt: row.taxInvoiceIssuedAt,
    taxable: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    tax: fromPaise(cgst + sgst + igst),
    total: fromPaise(taxable + cgst + sgst + igst),
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    buyerGstin: row.buyerGstin,
    buyerName: row.buyerName ?? '',
    placeOfSupplyState: row.placeOfSupplyState,
  };
}

async function gstReplacements(filters: ReportFilters): Promise<Record<string, unknown>> {
  return { ...sqlReplacements(filters), ...(await gstDocumentReplacements()) };
}

async function taxInvoiceRegister(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: goodsInvoiceRegisterSql(),
    orderBySql: `"taxInvoiceIssuedAt" DESC, "taxInvoiceNumber" ASC`,
    replacements: await gstReplacements(filters),
    filters,
    mapRow: mapTaxInvoiceRow,
  });
}

async function taxInvoiceRegisterExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: goodsInvoiceRegisterSql(),
    order: TAX_INVOICE_KEYSET,
    replacements: await gstReplacements(filters),
    limit,
    cursor,
    mapRow: mapTaxInvoiceRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

/** Goods invoices to buyers who gave a GSTIN (B2B). */
const B2B_ONLY = `AND d."recipientGstin" IS NOT NULL`;

async function b2bGstinSalesRegister(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: goodsInvoiceRegisterSql(B2B_ONLY),
    orderBySql: `"taxInvoiceIssuedAt" DESC, "subOrderId" DESC`,
    replacements: await gstReplacements(filters),
    filters,
    mapRow: mapTaxInvoiceRow,
  });
}

async function b2bGstinSalesRegisterExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const page = await keysetSqlQuery({
    selectSql: goodsInvoiceRegisterSql(B2B_ONLY),
    order: TAX_INVOICE_KEYSET,
    replacements: await gstReplacements(filters),
    limit,
    cursor,
    mapRow: mapTaxInvoiceRow,
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

/**
 * An inter-state invoice to an unregistered buyer above this value (₹1,00,000, GST
 * included) is reported invoice by invoice in GSTR-1 (B2CL), not in the state totals.
 */
export const B2CL_INVOICE_LIMIT_PAISE = 1_00_000_00;

/**
 * GSTR-1 rows for the documents issued in the range, per supplier GSTIN and GST rate:
 * - B2B: invoices to a buyer with a GSTIN, per invoice and rate;
 * - B2CL: inter-state invoices to unregistered buyers above ₹1 lakh, per invoice;
 * - B2CS: other invoices to unregistered buyers, per state and rate, net of their
 *   credit notes;
 * - CDNR / CDNUR: credit notes to registered buyers / against a B2CL invoice.
 * Each row carries CGST, SGST and IGST. Credit-note amounts are negative. Goods come
 * from the invoices as issued, so a return is counted once — on its credit note.
 */
function gstr1SelectSql(): string {
  const docsAll = `(${gstDocumentLinesSql()})`;
  return `
    WITH docs AS (${scopedGstDocumentLinesSql()}),
    invoice_totals AS (
      SELECT "supplierGstin", "documentNumber",
             SUM("taxablePaise" + "cgstPaise" + "sgstPaise" + "igstPaise") AS "valuePaise",
             BOOL_OR("igstPaise" <> 0) AS "interState"
      FROM ${docsAll} all_docs
      WHERE "docType" = 'INVOICE'
      GROUP BY "supplierGstin", "documentNumber"
    ),
    classified AS (
      SELECT d.*,
        CASE
          WHEN d."docType" = 'INVOICE' AND d."recipientGstin" IS NOT NULL THEN 'B2B'
          WHEN d."docType" = 'INVOICE' AND it."interState" AND it."valuePaise" > :b2clLimit THEN 'B2CL'
          WHEN d."docType" = 'INVOICE' THEN 'B2CS'
          WHEN d."recipientGstin" IS NOT NULL THEN 'CDNR'
          WHEN ai."interState" AND ai."valuePaise" > :b2clLimit THEN 'CDNUR'
          ELSE 'B2CS'
        END AS section
      FROM docs d
      LEFT JOIN invoice_totals it
        ON it."supplierGstin" = d."supplierGstin" AND it."documentNumber" = d."documentNumber"
      LEFT JOIN invoice_totals ai
        ON ai."supplierGstin" = d."supplierGstin" AND ai."documentNumber" = d."againstInvoiceNumber"
    )
    SELECT
      section,
      "supplierName",
      "supplierGstin",
      "documentNumber",
      MAX("documentDate") AS "documentDate",
      COALESCE(MAX("againstInvoiceNumber"), '') AS "againstInvoiceNumber",
      COALESCE("recipientGstin", '') AS "recipientGstin",
      state,
      COALESCE("gstRate", 0) AS "gstRate",
      SUM("taxablePaise")::bigint AS "taxablePaise",
      SUM("cgstPaise")::bigint AS "cgstPaise",
      SUM("sgstPaise")::bigint AS "sgstPaise",
      SUM("igstPaise")::bigint AS "igstPaise"
    FROM classified
    WHERE section <> 'B2CS'
    GROUP BY section, "supplierName", "supplierGstin", "documentNumber", "recipientGstin", state, "gstRate"

    UNION ALL

    SELECT
      'B2CS',
      "supplierName",
      "supplierGstin",
      'AGGREGATE',
      MAX("documentDate"),
      '',
      '',
      state,
      COALESCE("gstRate", 0),
      SUM("taxablePaise")::bigint,
      SUM("cgstPaise")::bigint,
      SUM("sgstPaise")::bigint,
      SUM("igstPaise")::bigint
    FROM classified
    WHERE section = 'B2CS'
    GROUP BY "supplierName", "supplierGstin", state, "gstRate"
  `;
}

function mapGstr1Row(row: Record<string, unknown>) {
  const cgst = Number(row.cgstPaise ?? 0);
  const sgst = Number(row.sgstPaise ?? 0);
  const igst = Number(row.igstPaise ?? 0);
  return {
    section: row.section,
    supplierName: row.supplierName,
    supplierGstin: row.supplierGstin,
    documentNumber: row.documentNumber,
    documentDate: row.documentDate,
    againstInvoiceNumber: row.againstInvoiceNumber,
    recipientGstin: row.recipientGstin,
    state: row.state,
    gstRate: Number(row.gstRate ?? 0),
    taxable: fromPaise(Number(row.taxablePaise ?? 0)),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    tax: fromPaise(cgst + sgst + igst),
  };
}

async function gstr1Filing(filters: ReportFilters) {
  assertReportRange(filters);
  return pagedSqlQuery({
    selectSql: gstr1SelectSql(),
    orderBySql: `section ASC, "supplierGstin" ASC, "documentDate" DESC, "documentNumber" ASC, state ASC, "gstRate" ASC`,
    replacements: { ...(await gstReplacements(filters)), b2clLimit: B2CL_INVOICE_LIMIT_PAISE },
    filters,
    mapRow: mapGstr1Row,
  });
}

/**
 * GSTR-3B for the documents issued in the range, net of the credit notes issued in it.
 * With a vendor: that vendor's outward supplies, and the TCS the platform collected on
 * them (the vendor's credit). Without: the platform's own supplies (goods it sells, its
 * fees and its commission invoices), the TCS it collected (its GSTR-8 liability, a
 * separate line, never added to output tax), and the sellers' supplies for reference.
 */
async function gstr3bSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const [rows] = await sequelize.query(
    `
    WITH docs AS (${scopedGstDocumentLinesSql()}),
    own AS (
      SELECT
        COALESCE(SUM("taxablePaise"), 0)::bigint AS taxable,
        COALESCE(SUM("igstPaise"), 0)::bigint AS igst,
        COALESCE(SUM("cgstPaise"), 0)::bigint AS cgst,
        COALESCE(SUM("sgstPaise"), 0)::bigint AS sgst
      FROM docs
      WHERE (:vendorId::uuid IS NOT NULL OR "supplierVendorId" IS NULL)
    ),
    sellers AS (
      SELECT
        COALESCE(SUM("taxablePaise"), 0)::bigint AS taxable,
        COALESCE(SUM("igstPaise" + "cgstPaise" + "sgstPaise"), 0)::bigint AS tax
      FROM docs
      WHERE "supplierVendorId" IS NOT NULL
    ),
    tcs AS (
      SELECT COALESCE(SUM(t."tcsAmountPaise"), 0)::bigint AS tcs
      FROM tcs_ledgers t
      INNER JOIN orders o ON o.id = t."orderId" AND o."deletedAt" IS NULL
      WHERE t."deletedAt" IS NULL
        AND t."createdAt" BETWEEN :from AND :to
        AND ${TCS_LEDGER_ORDER_SQL}
        AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)
    )
    SELECT 'OUTWARD_TAXABLE'::text AS line, own.taxable AS "amountPaise" FROM own
    UNION ALL SELECT 'OUTWARD_IGST', own.igst FROM own
    UNION ALL SELECT 'OUTWARD_CGST', own.cgst FROM own
    UNION ALL SELECT 'OUTWARD_SGST', own.sgst FROM own
    UNION ALL SELECT 'OUTWARD_TAX', own.igst + own.cgst + own.sgst FROM own
    UNION ALL SELECT
      CASE WHEN :vendorId::uuid IS NULL THEN 'TCS_COLLECTED' ELSE 'TCS_CREDIT' END, tcs.tcs FROM tcs
    UNION ALL SELECT 'SELLERS_OUTWARD_TAXABLE', sellers.taxable FROM sellers WHERE :vendorId::uuid IS NULL
    UNION ALL SELECT 'SELLERS_OUTWARD_TAX', sellers.tax FROM sellers WHERE :vendorId::uuid IS NULL
    `,
    { replacements: await gstReplacements({ ...filters, vendorId }) },
  );

  const mapped = (rows as Array<Record<string, unknown>>).map((row) => ({
    line: String(row.line ?? ''),
    amount: fromPaise(Number(row.amountPaise ?? 0)),
  }));

  return { rows: mapped, total: mapped.length, meta: { period: gstPeriodOf(filters.from) } };
}

/**
 * Gift cards over the period and what the platform still owes on them: cards sold
 * (paid), redeemed into wallets, expired unredeemed, and outstanding at the period
 * end — paid, not yet redeemed and not yet expired (a liability until then).
 */
async function giftCardLiability(filters: ReportFilters) {
  assertReportRange(filters);
  const paid = `g.status::text IN ('${GIFT_CARD_STATUS.ACTIVE}', '${GIFT_CARD_STATUS.REDEEMED}', '${GIFT_CARD_STATUS.EXPIRED}')`;
  const amountPaise = 'ROUND(g.amount * 100)';
  const [rows] = await sequelize.query(
    `
    SELECT 'SOLD'::text AS line, COUNT(*)::int AS "cardCount", COALESCE(SUM(${amountPaise}), 0)::bigint AS "amountPaise"
      FROM gift_cards g
     WHERE g."deletedAt" IS NULL AND ${paid} AND g."createdAt" BETWEEN :from AND :to
    UNION ALL
    SELECT 'REDEEMED'::text, COUNT(*)::int, COALESCE(SUM(${amountPaise}), 0)::bigint
      FROM gift_cards g
     WHERE g."deletedAt" IS NULL AND g."redeemedAt" BETWEEN :from AND :to
    UNION ALL
    SELECT 'EXPIRED_UNREDEEMED'::text, COUNT(*)::int, COALESCE(SUM(${amountPaise}), 0)::bigint
      FROM gift_cards g
     WHERE g."deletedAt" IS NULL AND ${paid} AND g."redeemedAt" IS NULL
       AND g."expiresAt" BETWEEN :from AND :to
    UNION ALL
    SELECT 'OUTSTANDING_AT_END'::text, COUNT(*)::int, COALESCE(SUM(${amountPaise}), 0)::bigint
      FROM gift_cards g
     WHERE g."deletedAt" IS NULL AND ${paid}
       AND g."createdAt" <= :to
       AND (g."redeemedAt" IS NULL OR g."redeemedAt" > :to)
       AND g."expiresAt" > :to
    `,
    { replacements: sqlReplacements(filters) },
  );
  const mapped = (rows as Array<Record<string, unknown>>).map((row) => ({
    line: String(row.line ?? ''),
    cardCount: Number(row.cardCount ?? 0),
    amount: fromPaise(Number(row.amountPaise ?? 0)),
  }));
  return { rows: mapped, total: mapped.length };
}

async function paymentGatewayReconciliation(filters: ReportFilters) {
  assertReportRange(filters);
  // Every Razorpay payment the gateway settles: orders, gift-card purchases and wallet
  // recharges, so the report's totals can be matched to Razorpay's settlements.
  const paidStatuses = `'${PAYMENT_STATUS.PAID}', '${PAYMENT_STATUS.REFUNDED}'`;
  const selectSql = `
    SELECT
      'ORDER'::text AS "sourceType",
      o.id AS "orderId",
      o."createdAt" AS "createdAt",
      o."paymentMethod"::text AS "paymentMethod",
      o."paymentStatus"::text AS "paymentStatus",
      COALESCE(o."razorpayOrderId", '') AS "razorpayOrderId",
      COALESCE(o."razorpayPaymentId", '') AS "razorpayPaymentId",
      COALESCE(o."razorpayAmountPaid", 0)::float AS "razorpayAmount",
      -- Captured only once the payment went through (never for an unpaid checkout).
      (CASE WHEN o."paymentStatus" IN (${paidStatuses}) AND o."razorpayPaymentId" IS NOT NULL
        THEN ROUND(COALESCE(o."razorpayAmountPaid", 0) * 100) ELSE 0 END)::bigint AS "capturedPaise",
      -- Card money sent back: a full cancellation (on the order), each cancelled or
      -- RTO'd part, and each return's Razorpay share. Issued (INITIATED) counts: it has
      -- left the gateway balance. A FAILED refund has not.
      (
        CASE WHEN o."cancelRefundStatus" IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
          THEN COALESCE(o."cancelRefundAmountPaise", 0) ELSE 0 END
        + COALESCE((
          SELECT SUM(ps."cancelRefundAmountPaise")
          FROM sub_orders ps
          WHERE ps."orderId" = o.id AND ps."deletedAt" IS NULL
            AND ps."cancelRefundStatus" IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
        ), 0)
        + COALESCE((
          SELECT SUM(ROUND(rr."razorpayRefundAmount" * 100))
          FROM return_requests rr
          INNER JOIN order_items ri ON ri.id = rr."orderItemId"
          INNER JOIN sub_orders rs ON rs.id = ri."subOrderId"
          WHERE rs."orderId" = o.id AND rr."deletedAt" IS NULL
            AND rr."refundStatus" IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
        ), 0)
      )::bigint AS "refundedPaise",
      COALESCE(o."totalAmount", 0)::float AS "orderTotal",
      COALESCE(o."walletAmountUsed", 0)::float AS "walletUsed",
      -- Keep in sync with resolvePaymentGatewayReconStatus
      CASE
        WHEN o."paymentMethod" <> '${PAYMENT_METHOD.RAZORPAY}' THEN 'NOT_APPLICABLE'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}' AND o."razorpayPaymentId" IS NOT NULL THEN 'MATCHED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
          AND o."razorpayPaymentId" IS NULL
          AND COALESCE(o."walletAmountUsed", 0) > 0
          AND (
            COALESCE(o."razorpayAmountPaid", 0) = 0
            OR COALESCE(o."walletAmountUsed", 0) >= COALESCE(o."totalAmount", 0)
          )
          THEN 'WALLET_SETTLED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
          AND o."razorpayPaymentId" IS NULL
          AND COALESCE(o."razorpayAmountPaid", 0) > 0
          THEN 'MISSING_PG_REF'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PENDING}' THEN 'PENDING'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.FAILED}' THEN 'FAILED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.REFUNDED}' THEN 'REFUNDED'
        ELSE 'REVIEW'
      END AS "reconStatus"
    FROM orders o
    WHERE o."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND o."paymentMethod" = '${PAYMENT_METHOD.RAZORPAY}'

    UNION ALL

    SELECT
      'GIFT_CARD'::text,
      g.id,
      g."createdAt",
      '${PAYMENT_METHOD.RAZORPAY}'::text,
      (CASE
        WHEN g.status::text IN ('${GIFT_CARD_STATUS.ACTIVE}', '${GIFT_CARD_STATUS.REDEEMED}', '${GIFT_CARD_STATUS.EXPIRED}')
          THEN '${PAYMENT_STATUS.PAID}'
        WHEN g.status::text = '${GIFT_CARD_STATUS.PENDING}' THEN '${PAYMENT_STATUS.PENDING}'
        ELSE '${PAYMENT_STATUS.FAILED}'
      END)::text,
      COALESCE(g."razorpayOrderId", ''),
      COALESCE(g."razorpayPaymentId", ''),
      COALESCE(g.amount, 0)::float,
      (CASE WHEN g."razorpayPaymentId" IS NOT NULL
          AND g.status::text IN ('${GIFT_CARD_STATUS.ACTIVE}', '${GIFT_CARD_STATUS.REDEEMED}', '${GIFT_CARD_STATUS.EXPIRED}')
        THEN ROUND(COALESCE(g.amount, 0) * 100) ELSE 0 END)::bigint,
      0::bigint,
      COALESCE(g.amount, 0)::float,
      0::float,
      (CASE
        WHEN g.status::text IN ('${GIFT_CARD_STATUS.ACTIVE}', '${GIFT_CARD_STATUS.REDEEMED}', '${GIFT_CARD_STATUS.EXPIRED}')
          THEN CASE WHEN g."razorpayPaymentId" IS NOT NULL THEN 'MATCHED' ELSE 'MISSING_PG_REF' END
        WHEN g.status::text = '${GIFT_CARD_STATUS.PENDING}' THEN 'PENDING'
        ELSE 'FAILED'
      END)::text
    FROM gift_cards g
    WHERE g."deletedAt" IS NULL
      AND g."createdAt" BETWEEN :from AND :to

    UNION ALL

    SELECT
      'WALLET_RECHARGE'::text,
      w.id,
      w."createdAt",
      '${PAYMENT_METHOD.RAZORPAY}'::text,
      (CASE
        WHEN w.status::text = 'PAID' AND w."refundStatus"::text IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
          THEN '${PAYMENT_STATUS.REFUNDED}'
        WHEN w.status::text = 'PAID' THEN '${PAYMENT_STATUS.PAID}'
        WHEN w.status::text = 'PENDING' THEN '${PAYMENT_STATUS.PENDING}'
        ELSE '${PAYMENT_STATUS.FAILED}'
      END)::text,
      COALESCE(w."razorpayOrderId", ''),
      COALESCE(w."razorpayPaymentId", ''),
      COALESCE(w."amountInr", 0)::float,
      (CASE WHEN w.status::text = 'PAID' AND w."razorpayPaymentId" IS NOT NULL
        THEN ROUND(COALESCE(w."amountInr", 0) * 100) ELSE 0 END)::bigint,
      -- A recharge refunded (e.g. it would have passed the wallet limit) goes back whole.
      (CASE WHEN w."refundStatus"::text IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
        THEN ROUND(COALESCE(w."amountInr", 0) * 100) ELSE 0 END)::bigint,
      COALESCE(w."amountInr", 0)::float,
      0::float,
      (CASE
        WHEN w.status::text = 'PAID' AND w."refundStatus"::text IN ('${REFUND_STATUS.INITIATED}', '${REFUND_STATUS.COMPLETED}')
          THEN 'REFUNDED'
        WHEN w.status::text = 'PAID'
          THEN CASE WHEN w."razorpayPaymentId" IS NOT NULL THEN 'MATCHED' ELSE 'MISSING_PG_REF' END
        WHEN w.status::text = 'PENDING' THEN 'PENDING'
        ELSE 'FAILED'
      END)::text
    FROM wallet_recharge_orders w
    WHERE w."deletedAt" IS NULL
      AND w."createdAt" BETWEEN :from AND :to
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      sourceType: row.sourceType,
      orderId: row.orderId,
      createdAt: row.createdAt,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      razorpayOrderId: row.razorpayOrderId,
      razorpayPaymentId: row.razorpayPaymentId,
      razorpayAmount: Number(row.razorpayAmount ?? 0),
      captured: fromPaise(Number(row.capturedPaise ?? 0)),
      refunded: fromPaise(Number(row.refundedPaise ?? 0)),
      net: fromPaise(Number(row.capturedPaise ?? 0) - Number(row.refundedPaise ?? 0)),
      orderTotal: Number(row.orderTotal ?? 0),
      walletUsed: Number(row.walletUsed ?? 0),
      reconStatus: row.reconStatus,
    }),
  });
}

/**
 * COD orders with the cash owed at the door and the cash agents collected. Cash due is
 * what the shipments are set to collect (`sqlCodCashDuePaise`): cancelled and RTO'd
 * parts leave it, as they leave the order's payment; it used to be the checkout
 * `amountDue`, which overstated it after a partial cancellation or an RTO.
 */
async function codRemittance(filters: ReportFilters) {
  assertReportRange(filters);
  const keptPart = `s."status" NOT IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')`;
  const selectSql = `
    SELECT
      o.id AS "orderId",
      o."createdAt" AS "createdAt",
      o.status::text AS "orderStatus",
      o."paymentStatus"::text AS "paymentStatus",
      ${sqlCodCashDuePaise('o')} AS "codDuePaise",
      COALESCE((
        SELECT SUM(ROUND(sh."codAmount"::numeric * 100))
        FROM shipments sh
        INNER JOIN sub_orders s ON s.id = sh."subOrderId" AND s."deletedAt" IS NULL
        WHERE s."orderId" = o.id AND sh."codCollected" = true
      ), 0)::bigint AS "codCollectedPaise",
      ROUND(COALESCE(o."walletAmountUsed", 0)::numeric * 100)::bigint AS "walletUsedPaise",
      CASE
        WHEN o.status = '${ORDER_STATUS.CANCELLED}' THEN 'CANCELLED'
        WHEN NOT EXISTS (
          SELECT 1 FROM sub_orders s
          WHERE s."orderId" = o.id AND s."deletedAt" IS NULL AND ${keptPart}
        ) THEN 'RETURNED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}' THEN 'COLLECTED'
        WHEN o.status = '${ORDER_STATUS.DELIVERED}' THEN 'DELIVERED_UNPAID'
        ELSE 'OPEN'
      END AS "codStatus"
    FROM orders o
    WHERE o."deletedAt" IS NULL
      AND o."paymentMethod" = '${PAYMENT_METHOD.COD}'
      AND o."createdAt" BETWEEN :from AND :to
      AND o.status <> '${ORDER_STATUS.CANCELLED}'
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      orderId: row.orderId,
      createdAt: row.createdAt,
      orderStatus: row.orderStatus,
      paymentStatus: row.paymentStatus,
      codAmount: fromPaise(Number(row.codDuePaise ?? 0)),
      codCollected: fromPaise(Number(row.codCollectedPaise ?? 0)),
      walletUsed: fromPaise(Number(row.walletUsedPaise ?? 0)),
      codStatus: row.codStatus,
    }),
  });
}

async function shippingLogistics(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      so.id AS "subOrderId",
      so."orderId" AS "orderId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      (so."shippingCostPaise" / 100.0)::float AS "shippingCost",
      COALESCE(so."shippingCharged", 0)::float AS "shippingCharged",
      COALESCE(sh.carrier, '') AS carrier,
      COALESCE(sh.status::text, 'NONE') AS "shipmentStatus",
      sh."shippedAt" AS "shippedAt",
      sh."deliveredAt" AS "deliveredAt",
      so."createdAt" AS "createdAt"
    FROM sub_orders so
    LEFT JOIN shipments sh ON sh."subOrderId" = so.id AND sh."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE so."deletedAt" IS NULL
      AND so."createdAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      subOrderId: row.subOrderId,
      orderId: row.orderId,
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? '',
      shippingCost: Number(row.shippingCost ?? 0),
      shippingCharged: Number(row.shippingCharged ?? 0),
      carrier: row.carrier,
      shipmentStatus: row.shipmentStatus,
      shippedAt: row.shippedAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
    }),
  });
}

async function abandonedCartReport(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      c.id AS "cartId",
      c."userId" AS "userId",
      u.email AS "userEmail",
      u.name AS "userName",
      c."updatedAt" AS "lastActivityAt",
      COUNT(ci.id)::int AS "itemCount",
      -- A cart has no frozen price by design, so live variant price IS the DB truth
      -- here. This is merchandise value only — no tax, shipping or discount — which is
      -- why the column is labelled as an estimate.
      COALESCE(SUM(ci.quantity * pv.price), 0)::float AS "cartValue"
    FROM carts c
    INNER JOIN cart_items ci ON ci."cartId" = c.id AND ci."deletedAt" IS NULL
    INNER JOIN product_variants pv ON pv.id = ci."variantId" AND pv."deletedAt" IS NULL
    LEFT JOIN users u ON u.id = c."userId"
    WHERE c."deletedAt" IS NULL
      AND c."userId" IS NOT NULL
      AND c."updatedAt" BETWEEN :from AND :to
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o."userId" = c."userId"
          AND o."deletedAt" IS NULL
          AND o."createdAt" >= c."updatedAt"
      )
    GROUP BY c.id, c."userId", u.email, u.name, c."updatedAt"
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"lastActivityAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      cartId: row.cartId,
      userId: row.userId,
      userEmail: row.userEmail ?? '',
      userName: row.userName ?? '',
      lastActivityAt: row.lastActivityAt,
      itemCount: Number(row.itemCount ?? 0),
      cartValue: Number(row.cartValue ?? 0),
    }),
  });
}

async function platformInventory(filters: ReportFilters) {
  assertReportRange(filters);
  const productWhere: Record<string, unknown> = {};
  if (filters.vendorId) productWhere.vendorId = filters.vendorId;
  if (filters.categoryId) productWhere.categoryId = filters.categoryId;
  if (filters.status) productWhere.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    ProductVariant,
    {
      where: { updatedAt: dateBetween(filters.from, filters.to) },
      include: [
        {
          model: Product,
          as: 'product',
          required: true,
          where: productWhere,
          attributes: ['id', 'name', 'categoryId', 'status', 'vendorId'],
          include: [
            {
              model: Vendor,
              as: 'vendor',
              attributes: ['id', 'businessName'],
              required: false,
            },
          ],
        },
      ],
      order: [['sku', 'ASC']],
    },
    filters,
  );

  return {
    rows: rows.map((v) => {
      const product = (v as ProductVariant & {
        product?: Product & { vendor?: Vendor };
      }).product;
      const stock = Number(v.stock ?? 0);
      const price = Number(v.price ?? 0);
      const lowStockAt = Number(v.lowStockAt ?? 0);
      return {
        variantId: v.id,
        sku: v.sku,
        productId: product?.id ?? v.productId,
        productName: product?.name ?? '',
        vendorId: product?.vendorId ?? null,
        vendorName: product?.vendor?.businessName ?? '',
        categoryId: product?.categoryId ?? null,
        stock,
        lowStockAt,
        isLowStock: stock <= lowStockAt,
        price,
        valuation: inventoryValuation(price, stock),
      };
    }),
    total,
  };
}

async function customerAnalytics(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      u.id AS "userId",
      COALESCE(u.email, '') AS email,
      COALESCE(u.name, '') AS name,
      COUNT(o.id)::int AS "orderCount",
      COALESCE(SUM(${sqlOrderKeptPaymentPaise('o')}), 0)::bigint AS "totalSpentPaise",
      MIN(o."createdAt") AS "firstOrderAt",
      MAX(o."createdAt") AS "lastOrderAt",
      CASE WHEN COUNT(o.id) <= 1 THEN 'NEW' ELSE 'RETURNING' END AS segment
    FROM users u
    INNER JOIN orders o ON o."userId" = u.id AND o."deletedAt" IS NULL
    WHERE o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
    GROUP BY u.id, u.email, u.name
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"totalSpentPaise" DESC, "userId" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      orderCount: Number(row.orderCount ?? 0),
      totalSpent: fromPaise(Number(row.totalSpentPaise ?? 0)),
      firstOrderAt: row.firstOrderAt,
      lastOrderAt: row.lastOrderAt,
      segment: row.segment,
    }),
  });
}

async function supportTicketSla(filters: ReportFilters) {
  assertReportRange(filters);
  const where: Record<string, unknown> = {
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    SupportTicket,
    {
      where,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((t) => {
      const created = t.createdAt as Date;
      const firstResponse = t.firstResponseAt;
      const resolved = t.resolvedAt;
      return {
        id: t.id,
        ticketNumber: t.ticketNumber,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: created,
        firstResponseAt: firstResponse,
        resolvedAt: resolved,
        firstResponseHours: firstResponse
          ? hoursBetween(created, firstResponse as Date)
          : null,
        resolutionHours: resolved ? hoursBetween(created, resolved as Date) : null,
      };
    }),
    total,
  };
}

async function vendorKycCompliance(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      v.id AS "vendorId",
      v."businessName" AS "vendorName",
      v.status::text AS status,
      COALESCE(v."gstNumber", '') AS "vendorGstin",
      COUNT(vd.id) FILTER (WHERE vd.verified = true)::int AS "verifiedDocs",
      COUNT(vd.id) FILTER (WHERE vd.verified = false AND vd."rejectedAt" IS NULL)::int AS "pendingDocs",
      COUNT(vd.id) FILTER (WHERE vd."rejectedAt" IS NOT NULL)::int AS "rejectedDocs",
      CASE
        WHEN COUNT(vd.id) FILTER (WHERE vd.verified = false AND vd."rejectedAt" IS NULL) > 0 THEN 'PENDING'
        WHEN COUNT(vd.id) FILTER (WHERE vd."rejectedAt" IS NOT NULL) > 0 THEN 'ACTION_REQUIRED'
        WHEN COUNT(vd.id) FILTER (WHERE vd.verified = true) > 0 THEN 'COMPLIANT'
        ELSE 'NO_DOCUMENTS'
      END AS "complianceStatus"
    FROM vendors v
    LEFT JOIN vendor_documents vd ON vd."vendorId" = v.id AND vd."deletedAt" IS NULL
    WHERE v."deletedAt" IS NULL
      AND v."createdAt" BETWEEN :from AND :to
      ${filters.vendorId ? 'AND v.id = :vendorId' : ''}
    GROUP BY v.id, v."businessName", v.status, v."gstNumber"
  `;
  const replacements = { ...sqlReplacements(filters) };
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"vendorName" ASC`,
    replacements,
    filters,
    mapRow: (row) => ({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      status: row.status,
      vendorGstin: row.vendorGstin,
      verifiedDocs: Number(row.verifiedDocs ?? 0),
      pendingDocs: Number(row.pendingDocs ?? 0),
      rejectedDocs: Number(row.rejectedDocs ?? 0),
      complianceStatus: row.complianceStatus,
    }),
  });
}

function mapWalletStatementRow(row: WalletLedger) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balanceAfter),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    description: row.description,
    pointSource: row.pointSource,
    createdAt: row.createdAt,
  };
}

async function customerWalletStatement(filters: ReportFilters) {
  assertReportRange(filters);
  if (!filters.userId) return emptyPage(filters);

  const { rows, total } = await pagedFindAndCount(
    WalletLedger,
    {
      where: {
        userId: filters.userId,
        createdAt: dateBetween(filters.from, filters.to),
      },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map(mapWalletStatementRow),
    total,
  };
}

async function vendorPayoutReconciliation(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      p.id AS "payoutId",
      p."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      p.amount::float AS amount,
      p.status::text AS status,
      p."periodStart" AS "periodStart",
      p."periodEnd" AS "periodEnd",
      COALESCE(p."paymentReferenceNumber", '') AS "paymentReferenceNumber",
      p."paidAt" AS "paidAt",
      p."createdAt" AS "createdAt",
      CASE
        WHEN p.status = 'PAID' AND p."paymentReferenceNumber" IS NOT NULL THEN 'MATCHED'
        WHEN p.status = 'PAID' AND p."paymentReferenceNumber" IS NULL THEN 'MISSING_PAYMENT_REF'
        WHEN p.status = 'PROCESSING' THEN 'IN_FLIGHT'
        WHEN p.status = 'FAILED' THEN 'FAILED'
        WHEN p.status = 'PENDING' THEN 'PENDING'
        ELSE 'REVIEW'
      END AS "reconStatus"
    FROM payouts p
    INNER JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
    WHERE p."deletedAt" IS NULL
      AND p."createdAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      payoutId: row.payoutId,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      amount: Number(row.amount ?? 0),
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      paymentReferenceNumber: row.paymentReferenceNumber,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      reconStatus: row.reconStatus,
    }),
  });
}

async function newsletterSubscribers(filters: ReportFilters) {
  assertReportRange(filters);
  const { rows, total } = await pagedFindAndCount(
    NewsletterSubscriber,
    {
      where: { createdAt: dateBetween(filters.from, filters.to) },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );
  return {
    rows: rows.map((row) => ({
      email: row.email,
      subscribedAt: row.createdAt,
    })),
    total,
  };
}

const taxInvoiceRegisterColumns = [
  { key: 'subOrderId', labelKey: 'subOrderId' },
  { key: 'orderId', labelKey: 'orderId' },
  { key: 'vendorId', labelKey: 'vendorId' },
  { key: 'vendorName', labelKey: 'vendorName' },
  { key: 'vendorGstin', labelKey: 'vendorGstin' },
  { key: 'taxInvoiceNumber', labelKey: 'taxInvoiceNumber' },
  { key: 'taxInvoiceIssuedAt', labelKey: 'taxInvoiceIssuedAt', format: 'date' as const },
  { key: 'taxable', labelKey: 'taxable', format: 'currency' as const },
  { key: 'cgst', labelKey: 'cgst', format: 'currency' as const },
  { key: 'sgst', labelKey: 'sgst', format: 'currency' as const },
  { key: 'igst', labelKey: 'igst', format: 'currency' as const },
  { key: 'tax', labelKey: 'taxAmount', format: 'currency' as const },
  { key: 'total', labelKey: 'totalAmount', format: 'currency' as const },
  { key: 'paymentMethod', labelKey: 'paymentMethod' },
  { key: 'paymentStatus', labelKey: 'paymentStatus' },
  { key: 'buyerGstin', labelKey: 'buyerGstin' },
  { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
];

export const adminFinanceGapReports: ReportDefinition[] = [
  {
    type: 'tax-invoice-register',
    labelKey: 'reportTaxInvoiceRegister',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: taxInvoiceRegisterColumns,
    query: taxInvoiceRegister,
    exportQuery: taxInvoiceRegisterExport,
  },
  {
    type: 'b2b-gstin-sales-register',
    labelKey: 'reportB2bGstinSalesRegister',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'taxInvoiceNumber', labelKey: 'taxInvoiceNumber' },
      { key: 'taxInvoiceIssuedAt', labelKey: 'taxInvoiceIssuedAt', format: 'date' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'buyerGstin', labelKey: 'buyerGstin' },
      { key: 'buyerName', labelKey: 'buyerName' },
      { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
      { key: 'tax', labelKey: 'taxAmount', format: 'currency' },
      { key: 'total', labelKey: 'totalAmount', format: 'currency' },
    ],
    query: b2bGstinSalesRegister,
    exportQuery: b2bGstinSalesRegisterExport,
  },
  {
    type: 'gstr-1-filing',
    labelKey: 'reportGstr1Filing',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'section', labelKey: 'section' },
      { key: 'supplierName', labelKey: 'supplierName' },
      { key: 'supplierGstin', labelKey: 'supplierGstin' },
      { key: 'documentNumber', labelKey: 'documentNumber' },
      { key: 'documentDate', labelKey: 'documentDate', format: 'date' },
      { key: 'againstInvoiceNumber', labelKey: 'againstInvoiceNumber' },
      { key: 'recipientGstin', labelKey: 'recipientGstin' },
      { key: 'state', labelKey: 'state' },
      { key: 'gstRate', labelKey: 'gstRate', format: 'number' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
      { key: 'tax', labelKey: 'taxAmount', format: 'currency' },
    ],
    query: gstr1Filing,
    exportQuery: createOffsetExportQuery(gstr1Filing),
  },
  {
    type: 'gstr-3b-summary',
    labelKey: 'reportGstr3bSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'line', labelKey: 'line' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
    ],
    query: gstr3bSummary,
    exportQuery: createSingleShotExportQuery(gstr3bSummary),
  },
  {
    type: 'payment-gateway-reconciliation',
    labelKey: 'reportPaymentGatewayReconciliation',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'sourceType', labelKey: 'pgSourceType' },
      { key: 'orderId', labelKey: 'pgReferenceId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'paymentMethod', labelKey: 'paymentMethod' },
      { key: 'paymentStatus', labelKey: 'paymentStatus' },
      { key: 'razorpayOrderId', labelKey: 'razorpayOrderId' },
      { key: 'razorpayPaymentId', labelKey: 'razorpayPaymentId' },
      { key: 'captured', labelKey: 'pgCaptured', format: 'currency' },
      { key: 'refunded', labelKey: 'pgRefunded', format: 'currency' },
      { key: 'net', labelKey: 'pgNet', format: 'currency' },
      { key: 'orderTotal', labelKey: 'totalAmount', format: 'currency' },
      { key: 'walletUsed', labelKey: 'walletUsed', format: 'currency' },
      { key: 'reconStatus', labelKey: 'reconStatus' },
    ],
    query: paymentGatewayReconciliation,
    exportQuery: createOffsetExportQuery(paymentGatewayReconciliation),
  },
  {
    type: 'gift-card-liability',
    labelKey: 'reportGiftCardLiability',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'line', labelKey: 'line' },
      { key: 'cardCount', labelKey: 'giftCardCount' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
    ],
    query: giftCardLiability,
    exportQuery: createSingleShotExportQuery(giftCardLiability),
  },
  {
    type: 'cod-remittance',
    labelKey: 'reportCodRemittance',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'orderStatus', labelKey: 'orderStatus' },
      { key: 'paymentStatus', labelKey: 'paymentStatus' },
      { key: 'codAmount', labelKey: 'codAmount', format: 'currency' },
      { key: 'codCollected', labelKey: 'codCollected', format: 'currency' },
      { key: 'walletUsed', labelKey: 'walletUsed', format: 'currency' },
      { key: 'codStatus', labelKey: 'codStatus' },
    ],
    query: codRemittance,
    exportQuery: createOffsetExportQuery(codRemittance),
  },
  {
    type: 'customer-analytics',
    labelKey: 'reportCustomerAnalytics',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'userId', labelKey: 'userId' },
      { key: 'email', labelKey: 'email' },
      { key: 'name', labelKey: 'name' },
      { key: 'orderCount', labelKey: 'orderCount', format: 'number' },
      { key: 'totalSpent', labelKey: 'totalSpent', format: 'currency' },
      { key: 'firstOrderAt', labelKey: 'firstOrderAt', format: 'date' },
      { key: 'lastOrderAt', labelKey: 'lastOrderAt', format: 'date' },
      { key: 'segment', labelKey: 'segment' },
    ],
    query: customerAnalytics,
    exportQuery: createOffsetExportQuery(customerAnalytics),
  },
  {
    type: 'vendor-payout-reconciliation',
    labelKey: 'reportVendorPayoutReconciliation',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.PAYOUT_MANAGE, PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'payoutId', labelKey: 'payoutId' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'amount', labelKey: 'payoutAmount', format: 'currency' },
      { key: 'status', labelKey: 'payoutStatus' },
      { key: 'periodStart', labelKey: 'periodStart', format: 'date' },
      { key: 'periodEnd', labelKey: 'periodEnd', format: 'date' },
      { key: 'paymentReferenceNumber', labelKey: 'paymentReferenceNumber' },
      { key: 'paidAt', labelKey: 'paidAt', format: 'date' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'reconStatus', labelKey: 'reconStatus' },
    ],
    query: vendorPayoutReconciliation,
    exportQuery: createOffsetExportQuery(vendorPayoutReconciliation),
  },
];

export const adminOpsGapReports: ReportDefinition[] = [
  {
    type: 'shipping-logistics',
    labelKey: 'reportShippingLogistics',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'shippingCost', labelKey: 'shippingCost', format: 'currency' },
      { key: 'shippingCharged', labelKey: 'shippingCharged', format: 'currency' },
      { key: 'carrier', labelKey: 'carrier' },
      { key: 'shipmentStatus', labelKey: 'shipmentStatus' },
      { key: 'shippedAt', labelKey: 'shippedAt', format: 'date' },
      { key: 'deliveredAt', labelKey: 'deliveredAt', format: 'date' },
    ],
    query: shippingLogistics,
    exportQuery: createOffsetExportQuery(shippingLogistics),
  },
  {
    type: 'abandoned-cart',
    labelKey: 'reportAbandonedCart',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'cartId', labelKey: 'cartId' },
      { key: 'userId', labelKey: 'userId' },
      { key: 'userEmail', labelKey: 'email' },
      { key: 'userName', labelKey: 'name' },
      { key: 'lastActivityAt', labelKey: 'lastActivityAt', format: 'date' },
      { key: 'itemCount', labelKey: 'itemCount', format: 'number' },
      { key: 'cartValue', labelKey: 'cartValue', format: 'currency' },
    ],
    query: abandonedCartReport,
    exportQuery: createOffsetExportQuery(abandonedCartReport),
  },
  {
    type: 'support-ticket-sla',
    labelKey: 'reportSupportTicketSla',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'ticketNumber', labelKey: 'ticketNumber' },
      { key: 'category', labelKey: 'category' },
      { key: 'priority', labelKey: 'priority' },
      { key: 'status', labelKey: 'status' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'firstResponseAt', labelKey: 'firstResponseAt', format: 'date' },
      { key: 'resolvedAt', labelKey: 'resolvedAt', format: 'date' },
      { key: 'firstResponseHours', labelKey: 'firstResponseHours', format: 'number' },
      { key: 'resolutionHours', labelKey: 'resolutionHours', format: 'number' },
    ],
    query: supportTicketSla,
    exportQuery: createOffsetExportQuery(supportTicketSla),
  },
  {
    type: 'vendor-kyc-compliance',
    labelKey: 'reportVendorKycCompliance',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.VENDOR_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'status', labelKey: 'status' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'verifiedDocs', labelKey: 'verifiedDocs', format: 'number' },
      { key: 'pendingDocs', labelKey: 'pendingDocs', format: 'number' },
      { key: 'rejectedDocs', labelKey: 'rejectedDocs', format: 'number' },
      { key: 'complianceStatus', labelKey: 'complianceStatus' },
    ],
    query: vendorKycCompliance,
    exportQuery: createOffsetExportQuery(vendorKycCompliance),
  },
  {
    type: 'newsletter-subscribers',
    labelKey: 'reportNewsletterSubscribers',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'email', labelKey: 'email' },
      { key: 'subscribedAt', labelKey: 'subscribedAt', format: 'date' },
    ],
    query: newsletterSubscribers,
    exportQuery: createOffsetExportQuery(newsletterSubscribers),
  },
];

export const adminCatalogGapReports: ReportDefinition[] = [
  {
    type: 'platform-inventory',
    labelKey: 'reportPlatformInventory',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.PRODUCT_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'sku', labelKey: 'sku' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'stock', labelKey: 'stock', format: 'number' },
      { key: 'lowStockAt', labelKey: 'lowStockAt', format: 'number' },
      { key: 'isLowStock', labelKey: 'isLowStock' },
      { key: 'price', labelKey: 'price', format: 'currency' },
      { key: 'valuation', labelKey: 'valuation', format: 'currency' },
    ],
    query: platformInventory,
    exportQuery: createOffsetExportQuery(platformInventory),
  },
];

export const vendorOwnerGapReports: ReportDefinition[] = [
  {
    type: 'vendor-tax-invoice-register',
    labelKey: 'reportTaxInvoiceRegister',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: taxInvoiceRegisterColumns,
    query: taxInvoiceRegister,
    exportQuery: taxInvoiceRegisterExport,
  },
];

export const customerGapReports: ReportDefinition[] = [
  {
    type: 'customer-wallet-statement',
    labelKey: 'reportCustomerWalletStatement',
    audience: 'customer',
    permissions: [],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'type', labelKey: 'type' },
      { key: 'amount', labelKey: 'pointsAmount', format: 'points' },
      { key: 'balanceAfter', labelKey: 'pointsBalanceAfter', format: 'points' },
      { key: 'referenceType', labelKey: 'referenceType' },
      { key: 'referenceId', labelKey: 'referenceId' },
      { key: 'pointSource', labelKey: 'pointSource' },
      { key: 'description', labelKey: 'description' },
    ],
    query: customerWalletStatement,
    exportQuery: createOffsetExportQuery(customerWalletStatement),
  },
];

export const reportGapDefinitions: ReportDefinition[] = [
  ...adminFinanceGapReports,
  ...adminOpsGapReports,
  ...adminCatalogGapReports,
  ...vendorOwnerGapReports,
  ...customerGapReports,
];
