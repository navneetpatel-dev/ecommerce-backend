import { COMMISSION_REFERENCE_TYPE } from '@core/constants/statuses';
import { frozenPaise, vendorNetPayoutPaise } from './frozenMoneySql';
import type { Paise } from './money';
import { gstOnTaxablePaise } from './pricing.engine';
import { isIntraStateSupply } from './gstPlaceOfSupply';

/** The commission_ledgers columns a payout reads. */
export interface PayoutLedgerRow {
  netPayoutAmountPaise?: unknown;
  commissionAmountPaise?: unknown;
  /** Sale value excluding GST: the Section 194-O TDS base. */
  taxableAmountPaise?: unknown;
  /** TDS rate frozen at checkout; null falls back to the current platform rate. */
  tdsRatePercent?: unknown;
  /**
   * Null on a sale ledger. Set on an adjustment row — a vendor-borne cashback cost
   * (negative), its reversal (positive), or a return after payout (negative) — which
   * is not a sale: no TDS. Only a return's commission counts toward commission GST.
   */
  referenceType?: string | null;
}

/**
 * GST the platform charges on its marketplace commission (SAC 9985), in paise. A negative
 * commission (a payout whose returns hand back more commission than its sales earned)
 * gives the GST back: the same amount, negative, rounded like a charge would be.
 */
export function commissionGstPaise(
  commissionTaxablePaise: Paise,
  gstRatePercent: number,
  intraState = false,
): Paise {
  // Intra-state: CGST and SGST at half the rate each, equal, as the commission invoice shows.
  return gstOnTaxablePaise(commissionTaxablePaise, gstRatePercent, intraState).total;
}

/** Section 194-O TDS on a (non-negative) sale value, rounded to the paisa. */
function tdsOnPaise(basePaise: Paise, ratePercent: number): Paise {
  return ratePercent > 0 ? Math.round((basePaise * ratePercent) / 100) : 0;
}

export type VendorPayoutBreakdown = {
  /**
   * Per ledger, in input order: net before TDS, the TDS base (sale value excluding
   * GST), the rate applied and the TDS withheld on it.
   */
  rows: Array<{ netPaise: Paise; tdsBasePaise: Paise; tdsRatePercent: number; tdsPaise: Paise }>;
  commissionTaxablePaise: Paise;
  commissionGstPaise: Paise;
  /**
   * Signed balance: sales after TDS and commission GST (at least zero), plus adjustment
   * rows. Negative when the vendor's cashback cost exceeds what their sales earned —
   * the payout run then carries the ledgers forward instead of paying.
   */
  balancePaise: Paise;
  /** What the vendor is actually paid: the balance, never below zero. */
  payoutPaise: Paise;
};

/**
 * What a vendor is paid for a set of commission ledgers — the one definition the
 * payout run and the vendor dashboard share:
 * - each sale ledger's net payout, less Section 194-O TDS on its sale value excluding
 *   GST (the ledger's taxable amount, net of returns), at the rate frozen on the
 *   ledger at checkout (`rates.tdsRatePercent` only for ledgers without one);
 * - less GST on the platform's commission across the sale ledgers;
 * - plus adjustment rows: a vendor-borne cashback cost is deducted and its reversal
 *   added back (no TDS); a return after payout recovers the net the vendor was paid
 *   for it, less the TDS withheld on it (reversed at the sale's rate), and its
 *   commission lowers the commission-GST base.
 */
export function vendorPayoutBreakdown(
  ledgers: PayoutLedgerRow[],
  rates: PayoutRates,
): VendorPayoutBreakdown {
  let afterTdsPaise = 0;
  let adjustmentPaise = 0;
  let commissionTaxablePaise = 0;
  const rows = ledgers.map((ledger) => {
    const netPaise = vendorNetPayoutPaise(ledger);
    const tdsRatePercent =
      ledger.tdsRatePercent != null ? Number(ledger.tdsRatePercent) : rates.tdsRatePercent;
    if (ledger.referenceType === COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK) {
      // A return after payout: the vendor gives back the net it was paid, and gets back
      // the TDS withheld on the returned sale value (a negative TDS row) and the GST on
      // the commission refunded with it.
      const tdsBasePaise = Math.min(0, frozenPaise(ledger.taxableAmountPaise));
      const tdsPaise = -tdsOnPaise(-tdsBasePaise, tdsRatePercent);
      adjustmentPaise += netPaise - tdsPaise;
      commissionTaxablePaise += frozenPaise(ledger.commissionAmountPaise);
      return { netPaise, tdsBasePaise, tdsRatePercent, tdsPaise };
    }
    if (ledger.referenceType) {
      // Cashback cost or its reversal: not a sale and not commission.
      adjustmentPaise += netPaise;
      return { netPaise, tdsBasePaise: 0, tdsRatePercent: 0, tdsPaise: 0 };
    }
    const tdsBasePaise = Math.max(0, frozenPaise(ledger.taxableAmountPaise));
    const tdsPaise = tdsOnPaise(tdsBasePaise, tdsRatePercent);
    afterTdsPaise += Math.max(0, netPaise - tdsPaise);
    commissionTaxablePaise += frozenPaise(ledger.commissionAmountPaise);
    return { netPaise, tdsBasePaise, tdsRatePercent, tdsPaise };
  });
  const gstPaise = commissionGstPaise(
    commissionTaxablePaise,
    rates.commissionGstRatePercent,
    rates.commissionIntraState ?? false,
  );
  // Sales never go below zero on their own (as before adjustments existed); only
  // deductions (cashback cost, returns after payout) larger than the sales can make
  // the balance negative.
  const balancePaise = Math.max(0, afterTdsPaise - gstPaise) + adjustmentPaise;
  return {
    rows,
    commissionTaxablePaise,
    commissionGstPaise: gstPaise,
    balancePaise,
    payoutPaise: Math.max(0, balancePaise),
  };
}

export type PayoutRates = {
  tdsRatePercent: number;
  commissionGstRatePercent: number;
  /** The platform and the vendor are in one state: commission GST is CGST + SGST. */
  commissionIntraState?: boolean;
};

/**
 * Rates for `vendorPayoutBreakdown` from platform settings. Pass the vendor's state so
 * the commission GST is worked out the way its commission invoice charges it.
 */
export function payoutRatesFromSettings(
  settings: {
    tdsRatePercent?: unknown;
    commissionGstRatePercent?: unknown;
    platformState?: string | null;
  },
  vendorState?: string | null,
): PayoutRates {
  return {
    tdsRatePercent: Number(settings.tdsRatePercent ?? 0),
    // Always set in practice (settings DEFAULTS); 18% is the SAC 9985 rate.
    commissionGstRatePercent: Number(settings.commissionGstRatePercent ?? 18),
    commissionIntraState:
      vendorState === undefined ? false : isIntraStateSupply(settings.platformState, vendorState),
  };
}
