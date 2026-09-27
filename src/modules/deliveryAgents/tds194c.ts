import type { Paise } from '@modules/pricing/money';

/**
 * TDS under s.194C on a delivery-agent payout (agents are contractors). It applies when
 * this payment exceeds the single-payment limit (₹30,000), or once the agent's payments
 * this financial year exceed the annual limit (₹1,00,000) — and then on the whole year's
 * payments, so what earlier payouts did not deduct is caught up on this one. Never more
 * than the payout itself.
 */
export function tds194cForPayout(input: {
  grossPaise: Paise;
  /** Gross of the agent's earlier payouts this financial year. */
  financialYearGrossPaise: Paise;
  /** TDS already deducted from those. */
  financialYearTdsPaise: Paise;
  ratePercent: number;
  singleThresholdPaise: Paise;
  annualThresholdPaise: Paise;
}): Paise {
  const rate = Number(input.ratePercent) || 0;
  const gross = Math.max(0, Math.round(input.grossPaise));
  if (rate <= 0 || gross === 0) return 0;
  const yearGross = Math.max(0, input.financialYearGrossPaise) + gross;
  let due = 0;
  if (input.annualThresholdPaise > 0 && yearGross > input.annualThresholdPaise) {
    due = Math.round((yearGross * rate) / 100) - Math.max(0, input.financialYearTdsPaise);
  } else if (input.singleThresholdPaise > 0 && gross > input.singleThresholdPaise) {
    due = Math.round((gross * rate) / 100);
  }
  return Math.min(gross, Math.max(0, due));
}

/** The 194C rate for an agent: the contractor rate with a PAN on file, else s.206AA's. */
export function tds194cRate(
  pan: unknown,
  settings: { deliveryAgentTdsRatePercent: number; deliveryAgentTdsNoPanRatePercent: number },
): number {
  const hasPan = typeof pan === 'string' && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase());
  return Number(hasPan ? settings.deliveryAgentTdsRatePercent : settings.deliveryAgentTdsNoPanRatePercent) || 0;
}
