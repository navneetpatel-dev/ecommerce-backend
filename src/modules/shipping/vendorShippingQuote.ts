import { lineSubtotal } from '@modules/pricing/displayMoney';
import { fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { resolveShippingDisplayKey } from '@modules/checkout/checkoutOrderTotals';
import { shippingService, type ShippingQuoteRate } from './shipping.service';
import { computeVendorShippingWeightGrams } from './shippingWeight';

export type VendorShippingLine = {
  unitPrice: number;
  quantity: number;
  weightGrams?: number | null;
  /** The line's value when it is not simply price × quantity (GST-inclusive, as billed). */
  lineAmountPaise?: number;
};

export type VendorShippingDestination = {
  pincode: string;
  state?: string;
};

export type VendorShippingQuote = {
  subtotal: number;
  weightGrams: number;
  rate: ShippingQuoteRate | null;
  shippingCost: number;
  shippingDisplayKey: 'FREE' | 'PAID';
};

export async function resolveVendorShippingQuote(input: {
  destination: VendorShippingDestination | null;
  vendorId: string | null;
  method: 'STANDARD' | 'EXPRESS';
  lines: VendorShippingLine[];
}): Promise<VendorShippingQuote> {
  // Summed in paise: a float sum can land a paisa under an exact threshold.
  const subtotal = fromPaise(
    input.lines.reduce(
      (sum, line) => sum + (line.lineAmountPaise ?? toPaise(lineSubtotal(line.unitPrice, line.quantity))),
      0,
    ),
  );
  const weightGrams = computeVendorShippingWeightGrams(
    input.lines.map((line) => ({
      quantity: line.quantity,
      variant: { weightGrams: line.weightGrams },
    })),
  );

  if (!input.destination || input.lines.length === 0) {
    return {
      subtotal,
      weightGrams,
      rate: null,
      shippingCost: 0,
      shippingDisplayKey: 'FREE',
    };
  }

  const rates = await shippingService.getRatesForQuote({
    pincode: input.destination.pincode,
    state: input.destination.state,
    weightGrams,
    method: input.method,
    vendorId: input.vendorId,
  });
  const rate = rates.find((candidate) => candidate.method === input.method) ?? null;
  const shippingCost = rate
    ? rate.freeShippingThreshold != null && subtotal >= rate.freeShippingThreshold
      ? 0
      : roundMoney(rate.cost)
    : 0;

  return {
    subtotal,
    weightGrams,
    rate,
    shippingCost,
    shippingDisplayKey: resolveShippingDisplayKey(shippingCost),
  };
}
