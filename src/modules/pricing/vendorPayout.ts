import { COMMISSION_REFERENCE_TYPE, COMMISSION_STATUS } from '@core/constants/statuses';
import { frozenPaise, vendorNetPayoutPaise } from './frozenMoneySql';
import type { Paise } from './money';
import { gstOnTaxablePaise } from './pricing.engine';
import { isIntraStateSupply } from './gstPlaceOfSupply';

/** The commission_ledgers columns a payout reads. */
export interface PayoutLedgerRow {
  netPayoutAmountPaise?: unknown;
  commissionAmountPaise?: unknown;
  /** Sale value excluding GST (the customer's share). */
  taxableAmountPaise?: unknown;
  /**
   * The sale's value of supply — including a coupon share the platform pays: the
   * Section 194-O TDS base. Null on older rows, where it equals `taxableAmountPaise`.
   */
  supplyTaxablePaise?: unknown;
  /**
   * 194-O rate on the ledger: 0 when the sale was exempt at checkout (194-O(4)); on a
   * settled sale, the rate its payout deducted at; on a return after payout, the rate
   * its sale was deducted at. Null falls back to the current platform rate.
   */
  tdsRatePercent?: unknown;
  /** PENDING or SETTLED: a pending sale is deducted at the rate in force now (the payout). */
  status?: unknown;
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

/** A ledger's 194-O base: its value of supply (older rows: its taxable value). */
function tdsBaseOf(ledger: PayoutLedgerRow): Paise {
  return ledger.supplyTaxablePaise != null
    ? Number(ledger.supplyTaxablePaise)
    : frozenPaise(ledger.taxableAmountPaise);
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
  /** Commission on the sales (the commission invoice's taxable value). */
  salesCommissionTaxablePaise: Paise;
  /** Commission handed back by returns after payout (the credit note's, negative). */
  returnsCommissionTaxablePaise: Paise;
  /** Sales plus returns: the net commission. */
  commissionTaxablePaise: Paise;
  /**
   * GST on the commission as its documents charge it: the invoice's GST on the sales
   * commission plus the credit note's (negative) on the returns', each rounded alone.
   */
  commissionGstPaise: Paise;
  /** The sale ledgers' net before TDS and commission GST. */
  salesNetPaise: Paise;
  /** 194-O TDS: withheld on the sales less the TDS given back on returns after payout. */
  tdsPaise: Paise;
  /** Adjustment rows' net: vendor-borne cashback (negative), its reversal, returns after payout. */
  adjustmentPaise: Paise;
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
 *   GST (its value of supply, net of returns), at the rate in force at the payout
 *   (`rates.tdsRatePercent`) — 0 for a sale exempt at checkout, and the rate already
 *   used for a settled sale;
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
  let adjustmentNetPaise = 0;
  let salesNetPaise = 0;
  let tdsTotalPaise = 0;
  let salesCommissionPaise = 0;
  let returnsCommissionPaise = 0;
  const rows = ledgers.map((ledger) => {
    const netPaise = vendorNetPayoutPaise(ledger);
    const frozenRatePercent = ledger.tdsRatePercent != null ? Number(ledger.tdsRatePercent) : null;
    if (ledger.referenceType === COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK) {
      const tdsRatePercent = frozenRatePercent ?? rates.tdsRatePercent;
      // A return after payout: the vendor gives back the net it was paid, and gets back
      // the TDS withheld on the returned sale value (a negative TDS row) and the GST on
      // the commission refunded with it.
      const tdsBasePaise = Math.min(0, tdsBaseOf(ledger));
      const tdsPaise = -tdsOnPaise(-tdsBasePaise, tdsRatePercent);
      adjustmentPaise += netPaise - tdsPaise;
      adjustmentNetPaise += netPaise;
      tdsTotalPaise += tdsPaise;
      returnsCommissionPaise += frozenPaise(ledger.commissionAmountPaise);
      return { netPaise, tdsBasePaise, tdsRatePercent, tdsPaise };
    }
    if (ledger.referenceType) {
      // Cashback cost or its reversal: not a sale and not commission.
      adjustmentPaise += netPaise;
      adjustmentNetPaise += netPaise;
      return { netPaise, tdsBasePaise: 0, tdsRatePercent: 0, tdsPaise: 0 };
    }
    // TDS is deducted when the payout credits the vendor, at the rate in force then: a
    // pending sale takes the current rate (unless it was exempt), a settled one keeps
    // the rate its payout used.
    const tdsRatePercent =
      frozenRatePercent !== null &&
      (frozenRatePercent === 0 || ledger.status === COMMISSION_STATUS.SETTLED)
        ? frozenRatePercent
        : rates.tdsRatePercent;
    const tdsBasePaise = Math.max(0, tdsBaseOf(ledger));
    const tdsPaise = tdsOnPaise(tdsBasePaise, tdsRatePercent);
    afterTdsPaise += Math.max(0, netPaise - tdsPaise);
    salesNetPaise += netPaise;
    tdsTotalPaise += tdsPaise;
    salesCommissionPaise += frozenPaise(ledger.commissionAmountPaise);
    return { netPaise, tdsBasePaise, tdsRatePercent, tdsPaise };
  });
  const intraState = rates.commissionIntraState ?? false;
  // Two documents, two roundings: the invoice's GST and the credit note's.
  const gstPaise =
    commissionGstPaise(salesCommissionPaise, rates.commissionGstRatePercent, intraState) +
    commissionGstPaise(returnsCommissionPaise, rates.commissionGstRatePercent, intraState);
  // Sales never go below zero on their own (as before adjustments existed); only
  // deductions (cashback cost, returns after payout) larger than the sales can make
  // the balance negative.
  const balancePaise = Math.max(0, afterTdsPaise - gstPaise) + adjustmentPaise;
  return {
    rows,
    salesCommissionTaxablePaise: salesCommissionPaise,
    returnsCommissionTaxablePaise: returnsCommissionPaise,
    commissionTaxablePaise: salesCommissionPaise + returnsCommissionPaise,
    commissionGstPaise: gstPaise,
    salesNetPaise,
    tdsPaise: tdsTotalPaise,
    adjustmentPaise: adjustmentNetPaise,
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
