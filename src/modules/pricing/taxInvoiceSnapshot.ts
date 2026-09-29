import type { Paise } from './money';

/** One tax invoice line as issued at checkout, in paise. */
export type TaxInvoiceSnapshotLine = {
  orderItemId: string;
  quantity: number;
  unitPricePaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  /**
   * HSN code and GST rate as charged, frozen with the amounts. Optional only for
   * snapshots written before they were recorded (backfilled by migration).
   */
  hsnCode?: string | null;
  gstPercentage?: number;
};

/**
 * The tax invoice amounts frozen when the invoice number is allocated at checkout.
 * Returns rewrite the order lines afterwards; the invoice keeps these amounts and
 * the credit note carries the return, so the return is not counted twice.
 */
export type TaxInvoiceSnapshot = {
  /** The invoice value: value of supply + GST. */
  totalPaise: Paise;
  lines: TaxInvoiceSnapshotLine[];
  /**
   * What the platform pays towards the invoice for a coupon it funds (its share and the
   * GST on it); the customer pays `totalPaise` less this. Absent when zero.
   */
  platformContributionPaise?: Paise;
};

/**
 * Snapshot line from the engine's paise breakdown of an order line: the vendor's value
 * of supply and the GST on it (before the platform's share of a coupon, which the
 * platform pays), not the customer's share.
 */
export function taxInvoiceSnapshotLine(
  orderItemId: string,
  line: {
    quantity: number;
    unitPricePaise: Paise;
    supplyTaxablePaise: Paise;
    supplyTax: { cgst: Paise; sgst: Paise; igst: Paise; gstPercentage: number };
  },
  hsnCode: string | null,
): TaxInvoiceSnapshotLine {
  return {
    hsnCode,
    gstPercentage: line.supplyTax.gstPercentage,
    orderItemId,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    taxablePaise: line.supplyTaxablePaise,
    cgstPaise: line.supplyTax.cgst,
    sgstPaise: line.supplyTax.sgst,
    igstPaise: line.supplyTax.igst,
  };
}

/** The discount on a snapshot line: its value before discount less its taxable value. */
export function snapshotLineDiscountPaise(line: TaxInvoiceSnapshotLine): Paise {
  return Math.max(0, line.unitPricePaise * line.quantity - line.taxablePaise);
}
