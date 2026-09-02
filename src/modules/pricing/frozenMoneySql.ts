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

/** Prefer the frozen paise column; fall back to the legacy rupee column × 100. */
export function frozenPaise(paiseValue: unknown, rupeeValue: unknown): number {
  const paise = Number(paiseValue ?? 0);
  const rupees = Number(rupeeValue ?? 0);
  if (paise !== 0) return paise;
  if (rupees === 0) return 0;
  return toPaise(rupees);
}

/** SQL form of `frozenPaise`. */
export function sqlFrozenPaise(alias: string, paiseCol: string, rupeeCol: string): string {
  return `CASE
    WHEN COALESCE(${alias}."${paiseCol}", 0) <> 0 THEN ${alias}."${paiseCol}"
    ELSE ROUND(COALESCE(${alias}."${rupeeCol}", 0)::numeric * 100)::bigint
  END`;
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

/**
 * Vendor net payout in paise from a commission_ledgers row.
 *
 * Prefers the frozen paise column, then the frozen rupee column. The last-resort
 * `saleAmount - commissionAmount` omits TCS, so it is only reached for pre-engine
 * rows that never had a TCS component.
 */
export function sqlVendorNetPayoutPaise(alias: string): string {
  return `CASE
    WHEN COALESCE(${alias}."netPayoutAmountPaise", 0) <> 0 THEN ${alias}."netPayoutAmountPaise"
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
