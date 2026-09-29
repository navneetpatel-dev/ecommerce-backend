import { settingsService } from '@modules/settings/settings.service';

/**
 * A credit note's CGST / SGST / IGST in paise. Notes store the split in paise; a few
 * early ones stored it in rupees, so when the parts do not add up to the note's tax the
 * tax is split again (IGST when the note had IGST, else two equal halves).
 */
function noteSplit(part: 'cgst' | 'sgst' | 'igst'): string {
  const stored = (key: string) => `COALESCE((cn."taxBreakdown"->>'${key}')::numeric, 0)`;
  const matches = `${stored('cgst')} + ${stored('sgst')} + ${stored('igst')} = cn."taxPaise"`;
  const inter = `${stored('igst')} > 0`;
  const fallback =
    part === 'igst'
      ? `CASE WHEN ${inter} THEN cn."taxPaise" ELSE 0 END`
      : part === 'cgst'
        ? `CASE WHEN ${inter} THEN 0 ELSE cn."taxPaise" / 2 END`
        : `CASE WHEN ${inter} THEN 0 ELSE cn."taxPaise" - cn."taxPaise" / 2 END`;
  return `(CASE WHEN ${matches} THEN ${stored(part)} ELSE ${fallback} END)::bigint`;
}

/**
 * Every outward-supply GST document line, as issued — the one source the GST reports
 * (GSTR-1, GSTR-3B, HSN summary, state-wise tax, the invoice and note registers) read,
 * so they agree with each other and with the documents the customer and vendor hold.
 *
 * - Goods invoices: each part's tax invoice, from the snapshot frozen when it was
 *   issued (amounts, HSN, GST rate) — never the order lines a return rewrote.
 * - Credit notes: returns and RTOs, dated when issued, amounts negative. A note takes
 *   its HSN and rate from the invoice line it reverses.
 * - The platform's own invoices and notes: gift wrapping, shipping, kept return fees,
 *   and marketplace commission (to the vendor, SAC 9985).
 *
 * Every row is dated by its document (`documentDate`), not by the order, so a return
 * lands in the month of its credit note and leaves the invoice's month as filed.
 * Amounts are signed paise: invoices positive, credit notes negative.
 *
 * Columns: "docType" ('INVOICE' | 'CREDIT_NOTE'), source ('GOODS' | 'PLATFORM_FEE' |
 * 'COMMISSION'), "supplierVendorId" (null when the platform supplies), "supplierName",
 * "supplierGstin", "recipientVendorId", "recipientGstin", state (place of supply),
 * "documentNumber", "documentDate", "againstInvoiceNumber", "orderId", "subOrderId",
 * "orderItemId", "categoryId", "hsnCode", "gstRate", qty, "taxablePaise", "cgstPaise",
 * "sgstPaise", "igstPaise", reason (a credit note's).
 *
 * Callers pass `:platformName` and `:platformGstin` (see `gstDocumentReplacements`).
 */
export function gstDocumentLinesSql(): string {
  const goodsLine = (snap: string) => `
      (${snap}->>'hsnCode') AS "hsnCode",
      (${snap}->>'gstPercentage')::numeric AS "gstRate"`;
  const platformLine = `
      (line->>'sac') AS "hsnCode",
      (line->>'gstRatePercent')::numeric AS "gstRate",
      (line->>'quantity')::int AS qty,
      (line->>'taxablePaise')::bigint AS "taxablePaise",
      (line->>'cgstPaise')::bigint AS "cgstPaise",
      (line->>'sgstPaise')::bigint AS "sgstPaise",
      (line->>'igstPaise')::bigint AS "igstPaise"`;
  const recipient = `NULLIF(TRIM(a.gstin), '') AS "recipientGstin", COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state`;
  return `
    -- Goods: each part's tax invoice as issued.
    SELECT
      'INVOICE'::text AS "docType",
      'GOODS'::text AS source,
      so."vendorId" AS "supplierVendorId",
      COALESCE(v."businessName", :platformName) AS "supplierName",
      COALESCE(NULLIF(v."gstNumber", ''), CASE WHEN so."vendorId" IS NULL THEN :platformGstin END, '') AS "supplierGstin",
      NULL::uuid AS "recipientVendorId",
      ${recipient},
      so."taxInvoiceNumber" AS "documentNumber",
      so."taxInvoiceIssuedAt" AS "documentDate",
      NULL::text AS "againstInvoiceNumber",
      so."orderId",
      so.id AS "subOrderId",
      (line->>'orderItemId')::uuid AS "orderItemId",
      p."categoryId",
      ${goodsLine('line')},
      (line->>'quantity')::int AS qty,
      (line->>'taxablePaise')::bigint AS "taxablePaise",
      (line->>'cgstPaise')::bigint AS "cgstPaise",
      (line->>'sgstPaise')::bigint AS "sgstPaise",
      (line->>'igstPaise')::bigint AS "igstPaise",
      NULL::text AS reason
    FROM sub_orders so
    INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
    CROSS JOIN LATERAL jsonb_array_elements(so."taxInvoiceSnapshot"->'lines') AS line
    LEFT JOIN vendors v ON v.id = so."vendorId"
    LEFT JOIN addresses a ON a.id = o."shippingAddressId"
    LEFT JOIN order_items oi ON oi.id = (line->>'orderItemId')::uuid
    LEFT JOIN product_variants pv ON pv.id = oi."variantId"
    LEFT JOIN products p ON p.id = pv."productId"
    WHERE so."deletedAt" IS NULL
      AND so."taxInvoiceNumber" IS NOT NULL
      AND so."taxInvoiceSnapshot" IS NOT NULL

    UNION ALL

    -- Credit notes (returns, RTO): negative, with the HSN and rate of the line they reverse.
    SELECT
      'CREDIT_NOTE'::text,
      CASE WHEN cn."vendorId" IS NULL AND cn."orderItemId" IS NULL THEN 'PLATFORM_FEE' ELSE 'GOODS' END,
      cn."vendorId",
      COALESCE(v."businessName", :platformName),
      COALESCE(NULLIF(v."gstNumber", ''), CASE WHEN cn."vendorId" IS NULL THEN :platformGstin END, ''),
      NULL::uuid,
      ${recipient},
      cn.number,
      COALESCE(cn."issuedAt", cn."createdAt"),
      cn."againstInvoiceNumber",
      cn."orderId",
      cn."subOrderId",
      cn."orderItemId",
      p."categoryId",
      COALESCE(inv_line->>'hsnCode', fee_line->>'sac'),
      COALESCE((inv_line->>'gstPercentage')::numeric, (fee_line->>'gstRatePercent')::numeric),
      -COALESCE(
        rr."returnQuantity",
        -- Without a return (an RTO), the note's share of the invoice line's value.
        CASE WHEN (inv_line->>'taxablePaise')::bigint > 0
          THEN ROUND(cn."merchandisePaise"::numeric * (inv_line->>'quantity')::int
                     / (inv_line->>'taxablePaise')::bigint)::int
        END,
        (fee_line->>'quantity')::int,
        0
      ),
      -cn."merchandisePaise"::bigint,
      -${noteSplit('cgst')},
      -${noteSplit('sgst')},
      -${noteSplit('igst')},
      cn.reason
    FROM credit_notes cn
    INNER JOIN orders o ON o.id = cn."orderId" AND o."deletedAt" IS NULL
    LEFT JOIN sub_orders so ON so.id = cn."subOrderId"
    LEFT JOIN vendors v ON v.id = cn."vendorId"
    LEFT JOIN addresses a ON a.id = o."shippingAddressId"
    LEFT JOIN return_requests rr ON rr.id = cn."returnRequestId" AND cn."orderItemId" IS NOT NULL
    LEFT JOIN order_items oi ON oi.id = cn."orderItemId"
    LEFT JOIN product_variants pv ON pv.id = oi."variantId"
    LEFT JOIN products p ON p.id = pv."productId"
    LEFT JOIN LATERAL (
      SELECT l FROM jsonb_array_elements(so."taxInvoiceSnapshot"->'lines') l
      WHERE l->>'orderItemId' = cn."orderItemId"::text
      LIMIT 1
    ) inv(inv_line) ON cn."orderItemId" IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN cn."subOrderId" IS NOT NULL THEN so."shippingInvoiceSnapshot"->'lines'->0
        ELSE o."platformInvoiceSnapshot"->'lines'->0
      END
    ) fee(fee_line) ON cn."orderItemId" IS NULL
    WHERE cn."deletedAt" IS NULL

    UNION ALL

    -- The platform's own invoices: gift wrap (order), shipping (each part), kept return fees.
    SELECT
      'INVOICE'::text, 'PLATFORM_FEE'::text, NULL::uuid, :platformName, :platformGstin, NULL::uuid,
      ${recipient},
      inv.snap->>'invoiceNumber',
      (inv.snap->>'issuedAt')::timestamptz,
      NULL::text,
      inv."orderId",
      inv."subOrderId",
      NULL::uuid,
      NULL::uuid,
      ${platformLine},
      NULL::text
    FROM (
      SELECT o."platformInvoiceSnapshot" AS snap, o.id AS "orderId", NULL::uuid AS "subOrderId",
             o."shippingAddressId" AS "addressId"
      FROM orders o
      WHERE o."deletedAt" IS NULL AND o."platformInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
      UNION ALL
      SELECT s."shippingInvoiceSnapshot", o.id, s.id, o."shippingAddressId"
      FROM sub_orders s
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      WHERE s."deletedAt" IS NULL AND s."shippingInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
      UNION ALL
      SELECT rr."returnFeeInvoiceSnapshot", o.id, s.id, o."shippingAddressId"
      FROM return_requests rr
      INNER JOIN sub_orders s ON s.id = rr."subOrderId"
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      WHERE rr."deletedAt" IS NULL AND rr."returnFeeInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
    ) inv
    CROSS JOIN LATERAL jsonb_array_elements(inv.snap->'lines') AS line
    LEFT JOIN addresses a ON a.id = inv."addressId"

    UNION ALL

    -- Marketplace commission invoices and credit notes (platform → vendor, B2B).
    SELECT
      CASE WHEN ci."taxablePaise" < 0 THEN 'CREDIT_NOTE' ELSE 'INVOICE' END,
      'COMMISSION'::text,
      NULL::uuid,
      :platformName,
      :platformGstin,
      ci."vendorId",
      NULLIF(TRIM(cv."gstNumber"), ''),
      COALESCE(NULLIF(ci."placeOfSupplyState", ''), NULLIF(cv.state, ''), 'UNKNOWN'),
      ci.number,
      ci."issuedAt",
      NULL::text,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      ci."sacCode",
      ci."gstRatePercent"::numeric,
      CASE WHEN ci."taxablePaise" < 0 THEN -1 ELSE 1 END,
      ci."taxablePaise"::bigint,
      ci."cgstPaise"::bigint,
      ci."sgstPaise"::bigint,
      ci."igstPaise"::bigint,
      CASE WHEN ci."taxablePaise" < 0 THEN 'Commission refunded with returns' END
    FROM commission_invoices ci
    LEFT JOIN vendors cv ON cv.id = ci."vendorId"
    WHERE ci."deletedAt" IS NULL
  `;
}

/**
 * `gstDocumentLinesSql` limited to the report range (by document date) and, when a
 * vendor is given, to the documents that vendor issued (its goods invoices and credit
 * notes — not the platform's, and not the commission invoices it received).
 */
export function scopedGstDocumentLinesSql(): string {
  return `
    SELECT * FROM (${gstDocumentLinesSql()}) gst_docs
    WHERE "documentDate" BETWEEN :from AND :to
      AND (:vendorId::uuid IS NULL OR "supplierVendorId" = :vendorId)`;
}

/** The platform's name and GSTIN, for the documents it issues. */
export async function gstDocumentReplacements(): Promise<{ platformName: string; platformGstin: string }> {
  const settings = await settingsService.getPlatformSettings();
  return {
    platformName: settings.platformLegalName || 'Platform',
    platformGstin: settings.platformGstin || '',
  };
}
