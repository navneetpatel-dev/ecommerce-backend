import type { Paise } from '@modules/pricing/money';

type PricedLine = { lineSubtotalPaise: Paise; taxablePaise: Paise; tax: { total: Paise } };
type Priced = { paise: { lines: PricedLine[] } };
export type LineDiscount = { discountPaise: Paise; vendorBorneDiscountPaise: Paise };
export type RowDiscounts = {
  /** Per-line pre-GST discounts, or null when the row has only a vendor-level total. */
  lineDiscounts: LineDiscount[] | null;
  merchandiseDiscountPaise: Paise;
  vendorBornePaise: Paise;
};

/** Rounds of nudging; each adds at most a paisa per line, and one round almost always does. */
const MAX_NUDGES = 3;

const inclusivePaise = (line: PricedLine) => line.taxablePaise + line.tax.total;

/** Adds a paisa of pre-GST discount, keeping the vendor-funded part in the same proportion. */
function nudged(discount: LineDiscount): LineDiscount {
  const ratio = discount.discountPaise > 0 ? discount.vendorBorneDiscountPaise / discount.discountPaise : 0;
  const discountPaise = discount.discountPaise + 1;
  return { discountPaise, vendorBorneDiscountPaise: Math.min(discountPaise, Math.round(discountPaise * ratio)) };
}

function totals(lineDiscounts: LineDiscount[]): Omit<RowDiscounts, 'lineDiscounts'> {
  return {
    merchandiseDiscountPaise: lineDiscounts.reduce((sum, line) => sum + line.discountPaise, 0),
    vendorBornePaise: lineDiscounts.reduce((sum, line) => sum + line.vendorBorneDiscountPaise, 0),
  };
}

/**
 * Coupons are advertised with GST included, but the engine takes the discount off the
 * pre-GST value and rounds GST per line, so "₹120 off" could come out as ₹119.99. This
 * prices the row, compares each line's real saving (its GST-inclusive total without the
 * coupon, less with it) with what that line was promised, and adds a paisa of pre-GST
 * discount wherever it fell short. The customer never gets less than advertised: exactly
 * the amount when the rounding allows it, otherwise a paisa more on that line. Every
 * figure comes from the engine itself, so GST bands and state rules are respected.
 *
 * `actualByLine` is each line's real GST-inclusive saving, for the screens and returns.
 */
export function priceAtLeastAdvertised<P extends Priced>(input: {
  /** The same lines priced with no coupon. */
  gross: { lines: PricedLine[] };
  resolved: RowDiscounts;
  /** GST-inclusive saving promised to each line (0 = none). */
  promisedByLine: Paise[];
  /** GST-inclusive saving promised to the row, when it has no per-line split. */
  promisedTotal: Paise;
  price: (discounts: RowDiscounts) => P;
}): { priced: P; discounts: RowDiscounts; actualByLine: Paise[] } {
  let discounts: RowDiscounts = {
    ...input.resolved,
    lineDiscounts: input.resolved.lineDiscounts?.map((line) => ({ ...line })) ?? null,
  };
  let priced = input.price(discounts);
  const saving = (current: P) =>
    current.paise.lines.map((line, index) => {
      const gross = input.gross.lines[index];
      return gross ? Math.max(0, inclusivePaise(gross) - inclusivePaise(line)) : 0;
    });

  for (let round = 0; round < MAX_NUDGES; round += 1) {
    const given = saving(priced);
    let changed = false;
    if (discounts.lineDiscounts) {
      const next = discounts.lineDiscounts.map((line, index) => {
        const promised = input.promisedByLine[index] ?? 0;
        const room = (priced.paise.lines[index]?.lineSubtotalPaise ?? 0) - line.discountPaise;
        if (promised <= 0 || (given[index] ?? 0) >= promised || room <= 0) return line;
        changed = true;
        return nudged(line);
      });
      if (changed) discounts = { lineDiscounts: next, ...totals(next) };
    } else if (input.promisedTotal > 0) {
      const givenTotal = given.reduce((sum, value) => sum + value, 0);
      const subtotal = priced.paise.lines.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
      if (givenTotal < input.promisedTotal && discounts.merchandiseDiscountPaise < subtotal) {
        const row = nudged({
          discountPaise: discounts.merchandiseDiscountPaise,
          vendorBorneDiscountPaise: discounts.vendorBornePaise,
        });
        discounts = { lineDiscounts: null, merchandiseDiscountPaise: row.discountPaise, vendorBornePaise: row.vendorBorneDiscountPaise };
        changed = true;
      }
    }
    if (!changed) break;
    priced = input.price(discounts);
  }
  return { priced, discounts, actualByLine: saving(priced) };
}
