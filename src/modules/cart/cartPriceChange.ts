import { roundMoney } from '@modules/pricing/money';

/** How a line's price moved since it went into the cart (B-55). */
export type CartPriceChange = {
  direction: 'UP' | 'DOWN';
  /** The GST-inclusive price per piece when it was added. */
  previousDisplayPrice: number;
};

/**
 * Compares the pre-GST price recorded at add with today's, and gives the old price
 * as the shopper saw it. Null when it has not moved or nothing was recorded.
 */
export function priceChangeFor(
  unitPriceAtAdd: unknown,
  currentPrice: number,
  toDisplayPrice: (price: number) => number,
): CartPriceChange | null {
  if (unitPriceAtAdd == null || unitPriceAtAdd === '') return null;
  const atAdd = roundMoney(Number(unitPriceAtAdd));
  if (!Number.isFinite(atAdd) || atAdd === roundMoney(currentPrice)) return null;
  return {
    direction: currentPrice > atAdd ? 'UP' : 'DOWN',
    previousDisplayPrice: toDisplayPrice(atAdd),
  };
}
