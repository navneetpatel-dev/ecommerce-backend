import { toPaise, type Paise } from './money';
import { splitTaxAmount } from './pricing.engine';

/** Gift wrapping is the platform's own service: GST at 18%, included in the fee. */
export const GIFT_WRAP_GST_RATE_PERCENT = 18;
/** SAC for the platform's support services, as on its commission invoices. */
export const PLATFORM_SERVICE_SAC = '9985';

export type PlatformInvoiceLine = {
  description: string;
  sac: string;
  quantity: number;
  gstRatePercent: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
};

/**
 * The platform's own tax invoice for fees it charges on an order (gift wrapping). The
 * amounts are frozen at checkout; the number (platform series) and date are set when the
 * order's first sub-order is dispatched, and stay null on an order cancelled before that.
 */
export type PlatformInvoiceSnapshot = {
  invoiceNumber: string | null;
  issuedAt: string | null;
  intraState: boolean;
  lines: PlatformInvoiceLine[];
  totalPaise: Paise;
};

/**
 * Split a GST-inclusive amount into taxable value and GST, in paise, so the parts add
 * up to the amount exactly: ₹49 at 18% is ₹41.53 + ₹7.47 (CGST ₹3.73 + SGST ₹3.74).
 */
export function gstInclusiveSplit(
  totalPaise: Paise,
  gstRatePercent: number,
  intraState: boolean,
): { taxablePaise: Paise; cgst: Paise; sgst: Paise; igst: Paise } {
  const taxablePaise =
    gstRatePercent > 0 ? Math.round((totalPaise * 100) / (100 + gstRatePercent)) : totalPaise;
  return { taxablePaise, ...splitTaxAmount(totalPaise - taxablePaise, intraState) };
}

/** Invoice line for a gift-wrap fee charged in rupees, GST included. */
export function giftWrapInvoiceLine(feeRupees: number, intraState: boolean): PlatformInvoiceLine {
  const split = gstInclusiveSplit(toPaise(feeRupees), GIFT_WRAP_GST_RATE_PERCENT, intraState);
  return {
    description: 'Gift wrapping',
    sac: PLATFORM_SERVICE_SAC,
    quantity: 1,
    gstRatePercent: GIFT_WRAP_GST_RATE_PERCENT,
    taxablePaise: split.taxablePaise,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
  };
}

export function platformInvoiceLineTotalPaise(line: PlatformInvoiceLine): Paise {
  return line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise;
}
