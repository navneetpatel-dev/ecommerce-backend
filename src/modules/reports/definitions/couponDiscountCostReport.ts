import { assertReportRange, fromPaise, pagedSqlQuery, COMMISSION_STATUS } from '../engine/queryHelpers';
import { sqlLedgerOnPaidOrder, sqlLedgerPlatformDiscountPaise, sqlLedgerPlatformGstPaise, sqlLedgerVendorDiscountPaise } from '@modules/pricing/frozenMoneySql';
import { COMMISSION_REFERENCE_TYPE, RETURN_STATUS } from '@core/constants/statuses';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';
import type { ReportFilters } from '../engine/types';
import { sqlReplacements } from './adminFinanceFilters';

export async function couponDiscountCost(filters: ReportFilters) {
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
 * share, and the shipping the coupons waived (split into what the platform and vendors fund). Discounts exclude
 * GST; shipping is as charged. Returns after payout take their share back.
 */
function couponDiscountSelectSql(): string {
  const saleOrReturn = `(cl."referenceType" IS NULL OR cl."referenceType" IN ('${COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK}', '${COMMISSION_REFERENCE_TYPE.OFFER_ADJUSTMENT}'))`;
  return `
    SELECT
      cl."vendorId"::text AS "vendorId",
      MAX(v."businessName") AS "vendorName",
      SUM(${sqlLedgerVendorDiscountPaise('cl')})::bigint AS "vendorDiscountPaise",
      SUM(${sqlLedgerPlatformDiscountPaise('cl')})::bigint AS "platformDiscountPaise",
      SUM(${sqlLedgerPlatformGstPaise('cl')})::bigint AS "platformGstPaise",
      SUM(CASE WHEN cl."referenceType" IS NULL
        THEN COALESCE(s."shippingDiscountAmountPaise", 0) ELSE 0 END)::bigint AS "freeShippingPaise",
      -- Vendors fund the shipping their own free-shipping coupons waive.
      COALESCE(SUM(CASE WHEN cl."referenceType" IS NULL THEN (
        SELECT -SUM(x."netPayoutAmountPaise") FROM commission_ledgers x
        WHERE x."subOrderId" = cl."subOrderId" AND x."deletedAt" IS NULL
          AND x."referenceType" = '${COMMISSION_REFERENCE_TYPE.SHIPPING_COUPON_COST}'
      ) END), 0)::bigint AS "vendorFreeShippingPaise",
      -- Held back on returns that broke an offer (GST incl.): vendor coupons' share went back to the vendor (OfferAdjustment rows); the rest is the platform's.
      COALESCE(SUM(CASE WHEN cl."referenceType" = '${COMMISSION_REFERENCE_TYPE.OFFER_ADJUSTMENT}' THEN cl."netPayoutAmountPaise" ELSE 0 END), 0)::bigint AS "vendorRecoveredPaise",
      (SELECT COALESCE(SUM(rr."offerAdjustmentPaise"), 0) FROM return_requests rr INNER JOIN sub_orders rs ON rs.id = rr."subOrderId"
        WHERE rs."vendorId" = cl."vendorId" AND rr."deletedAt" IS NULL AND rr."offerAdjustmentPaise" IS NOT NULL
          AND rr.status <> '${RETURN_STATUS.REJECTED}' AND rr."createdAt" BETWEEN :from AND :to)::bigint AS "returnsHeldBackPaise"
    FROM commission_ledgers cl
    INNER JOIN vendors v ON v.id = cl."vendorId"
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
  const vendorFreeShippingPaise = Number(row.vendorFreeShippingPaise ?? 0);
  const freeShippingPaise = Number(row.freeShippingPaise ?? 0) - vendorFreeShippingPaise;
  const vendorRecoveredPaise = Math.max(0, Number(row.vendorRecoveredPaise ?? 0));
  const platformRecoveredPaise = Math.max(0, Number(row.returnsHeldBackPaise ?? 0) - vendorRecoveredPaise);
  return {
    vendorId: String(row.vendorId ?? ''),
    vendorName: String(row.vendorName ?? ''),
    vendorDiscount: fromPaise(Number(row.vendorDiscountPaise ?? 0)),
    platformDiscount: fromPaise(platformPaise),
    platformDiscountGst: fromPaise(platformGstPaise),
    freeShippingCost: fromPaise(freeShippingPaise),
    vendorFreeShippingCost: fromPaise(vendorFreeShippingPaise),
    platformRecoveredOnReturns: fromPaise(platformRecoveredPaise),
    vendorRecoveredOnReturns: fromPaise(vendorRecoveredPaise),
    platformCouponCost: fromPaise(platformPaise + platformGstPaise + freeShippingPaise - platformRecoveredPaise),
  };
}

const COUPON_DISCOUNT_KEYSET: KeysetOrderCol[] = [
  { column: 'vendorName', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
];

export async function couponDiscountCostExport(
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
