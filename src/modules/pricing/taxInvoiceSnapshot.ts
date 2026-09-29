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
  totalPaise: Paise;
  lines: TaxInvoiceSnapshotLine[];
};

/** Snapshot line from the engine's paise breakdown of an order line. */
export function taxInvoiceSnapshotLine(
  orderItemId: string,
  line: {
    quantity: number;
    unitPricePaise: Paise;
    taxablePaise: Paise;
    tax: { cgst: Paise; sgst: Paise; igst: Paise; gstPercentage: number };
  },
  hsnCode: string | null,
): TaxInvoiceSnapshotLine {
  return {
    hsnCode,
    gstPercentage: line.tax.gstPercentage,
    orderItemId,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    taxablePaise: line.taxablePaise,
    cgstPaise: line.tax.cgst,
    sgstPaise: line.tax.sgst,
    igstPaise: line.tax.igst,
  };
}

/** The discount on a snapshot line: its value before discount less its taxable value. */
export function snapshotLineDiscountPaise(line: TaxInvoiceSnapshotLine): Paise {
  return Math.max(0, line.unitPricePaise * line.quantity - line.taxablePaise);
}
