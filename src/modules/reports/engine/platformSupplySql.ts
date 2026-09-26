import { GMV_SUB_ORDER_SQL, REPORTABLE_ORDER_SQL } from '@modules/pricing/frozenMoneySql';

/** One invoice line of a platform invoice snapshot, as report columns (alias `line`). */
const lineColumns = `
      (line->>'sac') AS sac,
      (line->>'quantity')::int AS qty,
      (line->>'taxablePaise')::bigint AS taxable,
      (line->>'cgstPaise')::bigint AS cgst,
      (line->>'sgstPaise')::bigint AS sgst,
      (line->>'igstPaise')::bigint AS igst`;

/**
 * The platform's own supplies on its tax invoices, one row per invoice line with the
 * customer's state, by order date (like marketplace sales in these reports):
 * - gift wrapping (the order's platform invoice), on orders that count;
 * - shipping on each part still standing (a cancelled or RTO'd part's shipping was
 *   refunded with it), less shipping refunded with a return (the platform credit note);
 * - return shipping fees kept from refunds.
 * Not a vendor's sale, so a vendor filter leaves them out.
 */
export function platformSupplyLinesSql(): string {
  return `
    SELECT COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state, ${lineColumns}
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(o."platformInvoiceSnapshot"->'lines') AS line
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE o."deletedAt" IS NULL
      AND o."platformInvoiceSnapshot" IS NOT NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      AND :vendorId::uuid IS NULL

    UNION ALL

    SELECT COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state, ${lineColumns}
    FROM sub_orders s
    INNER JOIN orders o ON o.id = s."orderId"
    CROSS JOIN LATERAL jsonb_array_elements(s."shippingInvoiceSnapshot"->'lines') AS line
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE s."shippingInvoiceSnapshot" IS NOT NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
      AND :vendorId::uuid IS NULL

    UNION ALL

    SELECT
      COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state,
      (s."shippingInvoiceSnapshot"->'lines'->0->>'sac') AS sac,
      0 AS qty,
      -cn."merchandisePaise"::bigint AS taxable,
      -COALESCE((cn."taxBreakdown"->>'cgst')::bigint, 0) AS cgst,
      -COALESCE((cn."taxBreakdown"->>'sgst')::bigint, 0) AS sgst,
      -COALESCE((cn."taxBreakdown"->>'igst')::bigint, 0) AS igst
    FROM credit_notes cn
    INNER JOIN sub_orders s ON s.id = cn."subOrderId"
    INNER JOIN orders o ON o.id = cn."orderId"
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE cn."deletedAt" IS NULL
      AND cn."vendorId" IS NULL
      AND cn."returnRequestId" IS NOT NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
      AND :vendorId::uuid IS NULL

    UNION ALL

    SELECT COALESCE(NULLIF(a.state, ''), 'UNKNOWN') AS state, ${lineColumns}
    FROM return_requests rr
    INNER JOIN sub_orders s ON s.id = rr."subOrderId"
    INNER JOIN orders o ON o.id = s."orderId"
    CROSS JOIN LATERAL jsonb_array_elements(rr."returnFeeInvoiceSnapshot"->'lines') AS line
    LEFT JOIN addresses a ON a.id = o."shippingAddressId" AND a."deletedAt" IS NULL
    WHERE rr."deletedAt" IS NULL
      AND rr."returnFeeInvoiceSnapshot" IS NOT NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${GMV_SUB_ORDER_SQL}
      AND :vendorId::uuid IS NULL
  `;
}

/**
 * The platform's own tax invoices issued in the period (gift wrap, shipping on a part,
 * a kept return fee), one row per invoice: number, date, recipient GSTIN and state,
 * taxable value and GST in paise. An invoice later reversed (an RTO'd part's shipping)
 * stays listed; its credit note reverses it. Not a vendor's, so a vendor filter leaves
 * them out.
 */
export function platformInvoiceDocumentsSql(): string {
  return `
    SELECT
      inv.snap->>'invoiceNumber' AS "documentNumber",
      (inv.snap->>'issuedAt')::timestamptz AS "documentDate",
      COALESCE(NULLIF(TRIM(a.gstin), ''), '') AS "recipientGstin",
      COALESCE(a.state, '') AS state,
      totals.taxable AS "taxablePaise",
      totals.tax AS "taxPaise"
    FROM (
      SELECT o."platformInvoiceSnapshot" AS snap, o."shippingAddressId" AS "addressId"
      FROM orders o
      WHERE o."deletedAt" IS NULL AND o."platformInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
      UNION ALL
      SELECT s."shippingInvoiceSnapshot", o."shippingAddressId"
      FROM sub_orders s
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      WHERE s."deletedAt" IS NULL AND s."shippingInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
      UNION ALL
      SELECT rr."returnFeeInvoiceSnapshot", o."shippingAddressId"
      FROM return_requests rr
      INNER JOIN sub_orders s ON s.id = rr."subOrderId"
      INNER JOIN orders o ON o.id = s."orderId" AND o."deletedAt" IS NULL
      WHERE rr."deletedAt" IS NULL AND rr."returnFeeInvoiceSnapshot"->>'invoiceNumber' IS NOT NULL
    ) inv
    CROSS JOIN LATERAL (
      SELECT
        SUM((line->>'taxablePaise')::bigint)::bigint AS taxable,
        SUM(
          (line->>'cgstPaise')::bigint + (line->>'sgstPaise')::bigint + (line->>'igstPaise')::bigint
        )::bigint AS tax
      FROM jsonb_array_elements(inv.snap->'lines') AS line
    ) totals
    LEFT JOIN addresses a ON a.id = inv."addressId"
    WHERE (inv.snap->>'issuedAt')::timestamptz BETWEEN :from AND :to
      AND :vendorId::uuid IS NULL
  `;
}
