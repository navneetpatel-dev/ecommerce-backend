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
  o."status" NOT IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')
  AND (
    o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
    OR (
      o."paymentMethod" = '${PAYMENT_METHOD.COD}'
      AND o."paymentStatus" NOT IN ('${PAYMENT_STATUS.FAILED}', '${PAYMENT_STATUS.REFUNDED}')
    )
  )
)`;

/**
 * Orders whose TCS rows count in GSTR-8 / GSTR-3B (alias `o` = orders). TCS is recorded
 * when a part is dispatched and invoiced, and reversed by an adjustment row if it comes
 * back, so each row is a real supply or its reversal: it counts whatever the order's
 * status is now (a fully RTO'd order keeps its collection and its reversal, each in its
 * own period). Only rows written at checkout before that change, on online orders that
 * were never paid, are left out.
 */
export const TCS_LEDGER_ORDER_SQL = `NOT (
  o."paymentMethod" <> '${PAYMENT_METHOD.COD}'
  AND o."paymentStatus" IN ('${PAYMENT_STATUS.PENDING}', '${PAYMENT_STATUS.FAILED}')
)`;

/**
 * Orders whose sale is real money (alias `o` = orders): COD, or an online order whose
 * payment went through. An online checkout still awaiting (or that failed) its payment
 * is not a sale yet — its ledger rows are not the vendor's earnings.
 */
export const PAID_OR_COD_ORDER_SQL = `NOT (
  o."paymentMethod" <> '${PAYMENT_METHOD.COD}'
  AND o."paymentStatus" IN ('${PAYMENT_STATUS.PENDING}', '${PAYMENT_STATUS.FAILED}')
)`;

/**
 * A commission ledger whose sale is real money (alias of the ledger row): its order is
 * COD or was paid online. An online checkout still awaiting (or that failed) payment
 * has ledgers written at checkout, but no sale yet — its commission, discounts and net
 * are not earned. The one filter every ledger-based report applies.
 */
export function sqlLedgerOnPaidOrder(alias = 'cl'): string {
  return `EXISTS (
    SELECT 1 FROM sub_orders paid_s
    INNER JOIN orders o ON o.id = paid_s."orderId"
    WHERE paid_s.id = ${alias}."subOrderId" AND ${PAID_OR_COD_ORDER_SQL}
  )`;
}

/**
 * How a sale ledger's merchandise discount splits between the platform and the vendor,
 * in paise (alias of a commission_ledgers row), per ledger — a stacked order can carry
 * both a platform and a vendor coupon, whatever the ledger's single `discountBearer`:
 * - platform: the share the platform funds — the supply value over the customer's
 *   taxable value; on rows written before the supply value was kept, what the net holds
 *   beyond taxable + GST − commission − TCS (then exactly that share);
 * - platform GST: the GST on that share the platform pays the vendor (none on older rows);
 * - vendor: the rest of the discount.
 * All excluding GST. A return after payout carries the returned share, negative.
 * TS twin: `ledgerCouponSplitPaise`.
 */
export function sqlLedgerPlatformDiscountPaise(alias = 'cl'): string {
  const raw = `(CASE WHEN ${alias}."supplyTaxablePaise" IS NOT NULL
    THEN ${alias}."supplyTaxablePaise" - ${alias}."taxableAmountPaise"
    ELSE ${alias}."netPayoutAmountPaise" - ${alias}."taxableAmountPaise" - ${alias}."taxAmountPaise"
      + ${alias}."commissionAmountPaise" + ${alias}."tcsAmountPaise"
  END)`;
  // Never outside the ledger's discount (0..discount, or discount..0 on a return), so a
  // row whose amounts were not written by the engine cannot show a negative vendor share.
  return `GREATEST(LEAST(${raw}, GREATEST(${alias}."discountAmountPaise", 0)), LEAST(${alias}."discountAmountPaise", 0))`;
}

export function sqlLedgerPlatformGstPaise(alias = 'cl'): string {
  return `(CASE WHEN ${alias}."supplyTaxablePaise" IS NOT NULL
    THEN ${alias}."netPayoutAmountPaise" - ${alias}."supplyTaxablePaise" - ${alias}."taxAmountPaise"
      + ${alias}."commissionAmountPaise" + ${alias}."tcsAmountPaise"
    ELSE 0
  END)`;
}

export function sqlLedgerVendorDiscountPaise(alias = 'cl'): string {
  return `(${alias}."discountAmountPaise" - ${sqlLedgerPlatformDiscountPaise(alias)})`;
}

/** TS twin of the `sqlLedger*DiscountPaise` / `sqlLedgerPlatformGstPaise` split. */
export function ledgerCouponSplitPaise(row: {
  discountAmountPaise?: unknown;
  taxableAmountPaise?: unknown;
  supplyTaxablePaise?: unknown;
  taxAmountPaise?: unknown;
  commissionAmountPaise?: unknown;
  tcsAmountPaise?: unknown;
  netPayoutAmountPaise?: unknown;
}): { vendorPaise: number; platformPaise: number; platformGstPaise: number } {
  const discount = frozenPaise(row.discountAmountPaise);
  const taxable = frozenPaise(row.taxableAmountPaise);
  const beyondTaxable =
    frozenPaise(row.netPayoutAmountPaise) -
    taxable -
    frozenPaise(row.taxAmountPaise) +
    frozenPaise(row.commissionAmountPaise) +
    frozenPaise(row.tcsAmountPaise);
  const withinDiscount = (value: number) =>
    Math.max(Math.min(value, Math.max(discount, 0)), Math.min(discount, 0));
  if (row.supplyTaxablePaise != null) {
    const supplyShare = Number(row.supplyTaxablePaise) - taxable;
    const platformPaise = withinDiscount(supplyShare);
    return { vendorPaise: discount - platformPaise, platformPaise, platformGstPaise: beyondTaxable - supplyShare };
  }
  const platformPaise = withinDiscount(beyondTaxable);
  return { vendorPaise: discount - platformPaise, platformPaise, platformGstPaise: 0 };
}

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
  -- Cancelled, or RETURNED: came back undelivered (RTO), refunded and credit-noted.
  AND s."status" NOT IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')
  AND o."deletedAt" IS NULL
  AND ${REPORTABLE_ORDER_SQL}
)`;

/**
 * What the customer paid for one order and kept paying for, in paise (alias =
 * orders): the checkout total frozen in `originalTotalAmount` (falling back to
 * `totalAmount` for orders placed before that column existed), less every
 * cancelled or RTO'd (RETURNED) sub-order's `customerTotal` — the amount refunded
 * (`subtotalPaise` for rows without one). A cancelled sub-order is already out of
 * GMV, tax, shipping and the ledgers, so its payment leaves here too. Return
 * refunds are reported separately: settlement "customer payments" sums this over
 * `REPORTABLE_ORDER_SQL` orders and lists refunds on their own line. Customer
 * analytics "total spent" and coupon "revenue impact" use `sqlOrderKeptPaymentPaise`.
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
      AND cs."status" IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')
      AND cs."deletedAt" IS NULL
  ), 0))`;
}

/**
 * What the customer paid for one order and kept, in paise (alias = orders): the
 * payment (`sqlOrderPaymentPaise`) less refunds on returns of delivered items — each
 * return whose vendor credit note is issued (its refund is done), at the amount
 * refunded. Customer "total spent" and coupon "revenue impact" count this: a
 * customer who bought ₹5,000 and returned ₹4,000 of it spent ₹1,000.
 */
export function sqlOrderKeptPaymentPaise(alias: string): string {
  return `GREATEST(0, ${sqlOrderPaymentPaise(alias)} - COALESCE((
    SELECT SUM(ROUND(rr."refundAmount"::numeric * 100))::bigint
    FROM return_requests rr
    INNER JOIN sub_orders rs ON rs.id = rr."subOrderId" AND rs."orderId" = ${alias}.id
    WHERE rr."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM credit_notes rcn
        WHERE rcn."returnRequestId" = rr.id
          AND rcn."vendorId" IS NOT NULL
          AND rcn."deletedAt" IS NULL
      )
  ), 0))`;
}
