import { PAYMENT_STATUS, PAYMENT_METHOD, ORDER_STATUS } from '@core/constants/statuses';

/**
 * Read-side primitives for money already frozen on order rows.
 *
 * Reporting, analytics and dashboards must never re-derive tax, commission or payout
 * from raw columns — they read the snapshot PricingEngine wrote at order time. These
 * helpers are the one definition of "which orders count" and "how to read a frozen
 * amount", so every read surface agrees.
 */

/**
 * Read a frozen amount in paise. The `*Paise` columns are the only stored money
 * value and are NOT NULL, so a missing value means the column was not loaded —
 * a query bug, never "zero". Throw rather than publish a made-up 0.
 */
export function frozenPaise(paiseValue: unknown): number {
  if (paiseValue === null || paiseValue === undefined) {
    throw new Error('Frozen paise amount was not loaded');
  }
  return Number(paiseValue);
}

/** SQL form of `frozenPaise`: the paise column itself. */
export function sqlFrozenPaise(alias: string, paiseCol: string): string {
  return `${alias}."${paiseCol}"`;
}

/**
 * Orders that count toward GMV / tax / recon reports (alias `o` = orders):
 * - Razorpay (etc.) once PAID
 * - COD once placed (not failed / refunded), even while paymentStatus is still PENDING
 *
 * A cancelled order never counts, whatever its paymentStatus. A prepaid order
 * stays PAID after cancellation until Razorpay reports the refund processed (and
 * forever if the refund call failed); every sub-order is already cancelled, so
 * counting the order would only leave its payment in "customer payments" with
 * nothing accounted against it.
 */
export const REPORTABLE_ORDER_SQL = `(
  o."status" <> '${ORDER_STATUS.CANCELLED}'
  AND (
    o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
    OR (
      o."paymentMethod" = '${PAYMENT_METHOD.COD}'
      AND o."paymentStatus" NOT IN ('${PAYMENT_STATUS.FAILED}', '${PAYMENT_STATUS.REFUNDED}')
    )
  )
)`;

/** The commission_ledgers column `vendorNetPayoutPaise` reads. */
export interface VendorNetPayoutSource {
  netPayoutAmountPaise?: unknown;
}

/**
 * Vendor net payout in paise from a commission_ledgers row — the one definition
 * payouts, settlement reports and vendor dashboards share. TS twin of
 * `sqlVendorNetPayoutPaise`; the two must stay in lockstep.
 */
export function vendorNetPayoutPaise(row: VendorNetPayoutSource): number {
  return frozenPaise(row.netPayoutAmountPaise);
}

/** Vendor net payout in paise from a commission_ledgers row (SQL twin of `vendorNetPayoutPaise`). */
export function sqlVendorNetPayoutPaise(alias: string): string {
  return sqlFrozenPaise(alias, 'netPayoutAmountPaise');
}

/**
 * Pre-discount merchandise value of one order line, in paise (alias = order_items).
 * Returns rewrite `lineSubtotal`, so this is net of returned quantity; pre-engine
 * rows without `lineSubtotal` fall back to `unitPricePaise × quantity`. Per sub-order
 * these lines sum to `sqlGmvPaise` of that sub-order.
 */
export function sqlLineSubtotalPaise(alias: string): string {
  return `COALESCE(
    ROUND(${alias}."lineSubtotal"::numeric * 100)::bigint,
    ${alias}."unitPricePaise" * ${alias}."quantity"
  )`;
}

/**
 * GMV of one sub-order in paise (alias = sub_orders): its frozen merchandise
 * subtotal, before discounts, tax and shipping. This is the GMV the settlement
 * reports publish; the admin dashboard, vendor rankings and trend charts must
 * sum this same expression over `REPORTABLE_ORDER_SQL` orders so every surface
 * shows one number.
 */
export function sqlGmvPaise(alias: string): string {
  return sqlFrozenPaise(alias, 'subtotalPaise');
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
 * What the customer paid for one order and kept paying for, in paise (alias =
 * orders): the checkout total frozen in `originalTotalAmount` (falling back to
 * `totalAmount` for orders placed before that column existed), less every
 * cancelled sub-order's `customerTotal` — the amount the cancel flow refunds
 * (`subtotalPaise` for rows without one). A cancelled sub-order is already out of
 * GMV, tax, shipping and the ledgers, so its payment leaves here too. Return
 * refunds are reported separately through credit notes. Settlement "customer
 * payments", customer analytics "total spent" and coupon "revenue impact" all
 * sum this over `REPORTABLE_ORDER_SQL` orders.
 */
export function sqlOrderPaymentPaise(alias: string): string {
  return `GREATEST(0, (CASE
    WHEN COALESCE(${alias}."originalTotalAmount", 0) > 0
      THEN ROUND(${alias}."originalTotalAmount"::numeric * 100)::bigint
    ELSE ROUND(COALESCE(${alias}."totalAmount", 0)::numeric * 100)::bigint
  END) - COALESCE((
    SELECT SUM(COALESCE(ROUND(cs."customerTotal"::numeric * 100)::bigint, cs."subtotalPaise"))
    FROM sub_orders cs
    WHERE cs."orderId" = ${alias}.id
      AND cs."status" = '${ORDER_STATUS.CANCELLED}'
      AND cs."deletedAt" IS NULL
  ), 0))`;
}
