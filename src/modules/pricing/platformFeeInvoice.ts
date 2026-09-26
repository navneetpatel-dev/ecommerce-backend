import { toPaise, type Paise } from './money';

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
 * up to the amount exactly. Intra-state, CGST and SGST are equal halves (as on any GST
 * invoice): ₹49 at 18% is ₹41.52 + ₹7.48 (CGST ₹3.74 + SGST ₹3.74).
 */
export function gstInclusiveSplit(
  totalPaise: Paise,
  gstRatePercent: number,
  intraState: boolean,
): { taxablePaise: Paise; cgst: Paise; sgst: Paise; igst: Paise } {
  if (!(gstRatePercent > 0)) return { taxablePaise: totalPaise, cgst: 0, sgst: 0, igst: 0 };
  const exactTaxablePaise = Math.round((totalPaise * 100) / (100 + gstRatePercent));
  if (!intraState) {
    return { taxablePaise: exactTaxablePaise, cgst: 0, sgst: 0, igst: totalPaise - exactTaxablePaise };
  }
  const half = Math.round((totalPaise - exactTaxablePaise) / 2);
  return { taxablePaise: totalPaise - 2 * half, cgst: half, sgst: half, igst: 0 };
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

/**
 * Shipping and delivery is the platform's own service (it keeps the fee): GST at 18%,
 * included in the shipping the customer pays, under SAC 9968 (courier services).
 */
export const SHIPPING_GST_RATE_PERCENT = 18;
export const SHIPPING_SAC = '9968';

/** A GST-inclusive platform fee as one invoice line. */
function inclusiveFeeLine(
  description: string,
  sac: string,
  gstRatePercent: number,
  amountPaise: Paise,
  intraState: boolean,
): PlatformInvoiceLine {
  const split = gstInclusiveSplit(amountPaise, gstRatePercent, intraState);
  return {
    description,
    sac,
    quantity: 1,
    gstRatePercent,
    taxablePaise: split.taxablePaise,
    cgstPaise: split.cgst,
    sgstPaise: split.sgst,
    igstPaise: split.igst,
  };
}

/** Invoice line for the shipping charged on one part (after any shipping discount). */
export function shippingInvoiceLine(chargedPaise: Paise, intraState: boolean): PlatformInvoiceLine {
  return inclusiveFeeLine('Shipping and delivery', SHIPPING_SAC, SHIPPING_GST_RATE_PERCENT, chargedPaise, intraState);
}

/** Invoice line for a return shipping fee kept from a refund. */
export function returnFeeInvoiceLine(feePaise: Paise, intraState: boolean): PlatformInvoiceLine {
  return inclusiveFeeLine('Return shipping fee', SHIPPING_SAC, SHIPPING_GST_RATE_PERCENT, feePaise, intraState);
}

/**
 * The part of a GST-inclusive amount refunded against a platform invoice line, split the
 * way the line was (its rate; CGST = SGST intra-state), for the platform credit note.
 */
export function refundOfInvoiceLine(
  line: Pick<PlatformInvoiceLine, 'gstRatePercent' | 'igstPaise'>,
  refundPaise: Paise,
): { taxablePaise: Paise; cgst: Paise; sgst: Paise; igst: Paise } {
  return gstInclusiveSplit(refundPaise, line.gstRatePercent, line.igstPaise === 0);
}

/** An unnumbered platform invoice of these lines (numbered when issued). */
export function unissuedPlatformInvoice(lines: PlatformInvoiceLine[], intraState: boolean): PlatformInvoiceSnapshot {
  return {
    invoiceNumber: null,
    issuedAt: null,
    intraState,
    lines,
    totalPaise: lines.reduce((sum, line) => sum + platformInvoiceLineTotalPaise(line), 0),
  };
}

export function platformInvoiceLineTotalPaise(line: PlatformInvoiceLine): Paise {
  return line.taxablePaise + line.cgstPaise + line.sgstPaise + line.igstPaise;
}
