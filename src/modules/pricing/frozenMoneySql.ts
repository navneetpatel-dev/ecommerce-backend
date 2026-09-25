import { PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS } from '@core/constants/statuses';
import { toPaise } from './money';

/**
 * Read-side primitives for money already frozen on order rows.
 *
 * Reporting, analytics and dashboards must never re-derive tax, commission or payout
 * from raw columns — they read the snapshot PricingEngine wrote at order time. These
 * helpers are the one definition of "which orders count" and "how to read a frozen
 * amount", so every read surface agrees.
 */

/**
 * Read a frozen amount in paise. The paise column is the stored value — 0 is a
 * real zero; NULL means the row predates its snapshot, and only then is the
 * rupee column read. Every reader of a paired column goes through this (or
 * `sqlFrozenPaise`), never through the raw paise field.
 */
export function frozenPaise(paiseValue: unknown, rupeeValue: unknown): number {
  if (paiseValue != null) return Number(paiseValue);
  return toPaise(Number(rupeeValue ?? 0));
}

/** SQL form of `frozenPaise`. */
export function sqlFrozenPaise(alias: string, paiseCol: string, rupeeCol: string): string {
  return `COALESCE(
    ${alias}."${paiseCol}",
    ROUND(COALESCE(${alias}."${rupeeCol}", 0)::numeric * 100)::bigint
  )`;
}

/**
 * Orders that count toward GMV / tax / recon reports (alias `o` = orders):
 * - Razorpay (etc.) once PAID
 * - COD once placed (not cancelled / failed), even while paymentStatus is still PENDING
 */
export const REPORTABLE_ORDER_SQL = `(
  o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
  OR (
    o."paymentMethod" = '${PAYMENT_METHOD.COD}'
    AND o."paymentStatus" NOT IN ('${PAYMENT_STATUS.FAILED}', '${PAYMENT_STATUS.REFUNDED}')
    AND o."status" <> '${ORDER_STATUS.CANCELLED}'
  )
)`;

/** The commission_ledgers columns `vendorNetPayoutPaise` reads. */
export interface VendorNetPayoutSource {
  netPayoutAmountPaise?: unknown;
  netPayoutAmount?: unknown;
  saleAmount?: unknown;
  commissionAmount?: unknown;
  tcsAmount?: unknown;
}

/**
 * Vendor net payout in paise from a commission_ledgers row — the one definition
 * payouts, settlement reports and vendor dashboards share. TS twin of
 * `sqlVendorNetPayoutPaise`; the two must stay in lockstep.
 *
 * Prefers the frozen paise column, then the frozen rupee column, then derives
 * `sale − commission − TCS` for pre-engine rows that have neither.
 */
export function vendorNetPayoutPaise(row: VendorNetPayoutSource): number {
  if (row.netPayoutAmountPaise != null) return Number(row.netPayoutAmountPaise);
  if (row.netPayoutAmount != null) return toPaise(Number(row.netPayoutAmount));
  return (
    toPaise(Number(row.saleAmount ?? 0)) -
    toPaise(Number(row.commissionAmount ?? 0)) -
    toPaise(Number(row.tcsAmount ?? 0))
  );
}

/**
 * Vendor net payout in paise from a commission_ledgers row (SQL twin of
 * `vendorNetPayoutPaise`).
 *
 * Prefers the frozen paise column, then the frozen rupee column, then derives
 * `sale − commission − TCS` for pre-engine rows that have neither.
 */
export function sqlVendorNetPayoutPaise(alias: string): string {
  return `CASE
    WHEN ${alias}."netPayoutAmountPaise" IS NOT NULL THEN ${alias}."netPayoutAmountPaise"
    ELSE ROUND(
      (
        CASE
          WHEN ${alias}."netPayoutAmount" IS NOT NULL THEN ${alias}."netPayoutAmount"::numeric
          ELSE COALESCE(${alias}."saleAmount", 0)::numeric
               - COALESCE(${alias}."commissionAmount", 0)::numeric
               - COALESCE(${alias}."tcsAmount", 0)::numeric
        END
      ) * 100
    )::bigint
  END`;
}

/**
 * Pre-discount merchandise value of one order line, in paise (alias = order_items).
 * Returns rewrite `lineSubtotal`, so this is net of returned quantity; pre-engine
 * rows without `lineSubtotal` fall back to `unitPrice × quantity`. Per sub-order
 * these lines sum to `sqlGmvPaise` of that sub-order.
 */
export function sqlLineSubtotalPaise(alias: string): string {
  return `ROUND(
    COALESCE(${alias}."lineSubtotal", ${alias}."unitPrice" * ${alias}."quantity", 0)::numeric * 100
  )::bigint`;
}

/**
 * GMV of one sub-order in paise (alias = sub_orders): its frozen merchandise
 * subtotal, before discounts, tax and shipping. This is the GMV the settlement
 * reports publish; the admin dashboard, vendor rankings and trend charts must
 * sum this same expression over `REPORTABLE_ORDER_SQL` orders so every surface
 * shows one number.
 */
export function sqlGmvPaise(alias: string): string {
  return sqlFrozenPaise(alias, 'subtotalPaise', 'subtotal');
}

/**
 * Sub-orders whose merchandise counts toward GMV (aliases `s` = sub_orders,
 * `o` = its order): not cancelled — a cancelled sub-order was refunded — on a
 * reportable order. Returns need no filter; they are already netted out of
 * `subtotal` / `lineSubtotal`. Every GMV and revenue surface filters with this
 * and sums `sqlGmvPaise('s')` (or `sqlLineSubtotalPaise` per line), so the
 * dashboards, rankings, trend charts and settlement reports publish one number.
 */
export const GMV_SUB_ORDER_SQL = `(
  s."deletedAt" IS NULL
  AND s."status" <> '${ORDER_STATUS.CANCELLED}'
  AND o."deletedAt" IS NULL
  AND ${REPORTABLE_ORDER_SQL}
)`;

/**
 * What the customer was charged for one order, in paise (alias = orders): the
 * checkout total frozen in `originalTotalAmount`, falling back to `totalAmount`
 * for orders placed before that column existed. Returns and cancellations are
 * reported separately, so this stays the gross charge. Settlement "customer
 * payments", customer analytics "total spent" and coupon "revenue impact" all
 * sum this over `REPORTABLE_ORDER_SQL` orders.
 */
export function sqlOrderPaymentPaise(alias: string): string {
  return `CASE
    WHEN COALESCE(${alias}."originalTotalAmount", 0) > 0
      THEN ROUND(${alias}."originalTotalAmount"::numeric * 100)::bigint
    ELSE ROUND(COALESCE(${alias}."totalAmount", 0)::numeric * 100)::bigint
  END`;
}
