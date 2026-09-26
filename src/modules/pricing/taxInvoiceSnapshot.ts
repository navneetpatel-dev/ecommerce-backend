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
    tax: { cgst: Paise; sgst: Paise; igst: Paise };
  },
): TaxInvoiceSnapshotLine {
  return {
    orderItemId,
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
    taxablePaise: line.taxablePaise,
    cgstPaise: line.tax.cgst,
    sgstPaise: line.tax.sgst,
    igstPaise: line.tax.igst,
  };
}
