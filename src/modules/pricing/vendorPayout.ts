import { frozenPaise, vendorNetPayoutPaise } from './frozenMoneySql';
import type { Paise } from './money';

/** The commission_ledgers columns a payout reads. */
export interface PayoutLedgerRow {
  netPayoutAmountPaise?: unknown;
  commissionAmountPaise?: unknown;
}

/** GST the platform charges on its marketplace commission (SAC 9985), in paise. */
export function commissionGstPaise(commissionTaxablePaise: Paise, gstRatePercent: number): Paise {
  if (commissionTaxablePaise <= 0 || gstRatePercent <= 0) return 0;
  return Math.round((commissionTaxablePaise * gstRatePercent) / 100);
}

export type VendorPayoutBreakdown = {
  /** Per ledger, in input order: net before TDS and the TDS withheld on it. */
  rows: Array<{ netPaise: Paise; tdsPaise: Paise }>;
  commissionTaxablePaise: Paise;
  commissionGstPaise: Paise;
  /** What the vendor is actually paid. */
  payoutPaise: Paise;
};

/**
 * What a vendor is paid for a set of commission ledgers — the one definition the
 * payout run and the vendor dashboard share:
 * - each ledger's net payout, less Section 194-O TDS on that net;
 * - then less GST on the platform's commission across the ledgers.
 */
export function vendorPayoutBreakdown(
  ledgers: PayoutLedgerRow[],
  rates: { tdsRatePercent: number; commissionGstRatePercent: number },
): VendorPayoutBreakdown {
  let afterTdsPaise = 0;
  let commissionTaxablePaise = 0;
  const rows = ledgers.map((ledger) => {
    const netPaise = vendorNetPayoutPaise(ledger);
    const tdsPaise =
      rates.tdsRatePercent > 0 ? Math.round((netPaise * rates.tdsRatePercent) / 100) : 0;
    afterTdsPaise += Math.max(0, netPaise - tdsPaise);
    commissionTaxablePaise += frozenPaise(ledger.commissionAmountPaise);
    return { netPaise, tdsPaise };
  });
  const gstPaise = commissionGstPaise(commissionTaxablePaise, rates.commissionGstRatePercent);
  return {
    rows,
    commissionTaxablePaise,
    commissionGstPaise: gstPaise,
    payoutPaise: Math.max(0, afterTdsPaise - gstPaise),
  };
}

/** Rates for `vendorPayoutBreakdown` from platform settings. */
export function payoutRatesFromSettings(settings: {
  tdsRatePercent?: unknown;
  commissionGstRatePercent?: unknown;
}): { tdsRatePercent: number; commissionGstRatePercent: number } {
  return {
    tdsRatePercent: Number(settings.tdsRatePercent ?? 0),
    // Always set in practice (settings DEFAULTS); 18% is the SAC 9985 rate.
    commissionGstRatePercent: Number(settings.commissionGstRatePercent ?? 18),
  };
}
