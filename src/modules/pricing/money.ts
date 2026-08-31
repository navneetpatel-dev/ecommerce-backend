/** Integer minor-unit helpers — all PricingEngine math uses paise. */

export type Paise = number;

export function toPaise(rupees: number): Paise {
  return Math.round(Number(rupees || 0) * 100);
}

export function fromPaise(paise: Paise): number {
  return Math.round(Number(paise || 0)) / 100;
}

/**
 * Coerce Sequelize DECIMAL / API values to finite rupees without changing stored scale.
 * DECIMAL columns arrive as strings in Node; always use this at read boundaries.
 */
export function coerceRupees(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimal places (rupees), preserving stored DECIMAL values. */
export function roundMoney(value: unknown): number {
  return fromPaise(toPaise(coerceRupees(value)));
}

/** Distribute `total` across weights; remainder goes to the largest weight index. */
export function allocateProportionally(total: Paise, weights: number[]): Paise[] {
  const n = weights.length;
  if (n === 0) return [];
  const result = new Array<Paise>(n).fill(0);
  const positive = weights.map((w, i) => ({ i, w: Math.max(0, Number(w) || 0) }));
  const sum = positive.reduce((s, row) => s + row.w, 0);
  if (total === 0 || sum <= 0) return result;

  let allocated = 0;
  let largestIdx = positive[0]!.i;
  let largestWeight = positive[0]!.w;

  for (const row of positive) {
    if (row.w > largestWeight) {
      largestWeight = row.w;
      largestIdx = row.i;
    }
    const share = Math.round((total * row.w) / sum);
    result[row.i] = share;
    allocated += share;
  }

  const remainder = total - allocated;
  if (remainder !== 0) {
    result[largestIdx] = (result[largestIdx] ?? 0) + remainder;
  }
  return result;
}
