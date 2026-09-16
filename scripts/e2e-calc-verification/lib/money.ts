export function toPaise(rupees: number): number {
  return Math.round(Number(rupees || 0) * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(Number(paise || 0)) / 100;
}

export function roundMoney(value: number): number {
  return fromPaise(toPaise(value));
}

/** Mirrors backend money.ts allocateProportionally: remainder goes to the largest weight. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const result = new Array(n).fill(0);
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

/** Mirrors backend pricing.engine.ts splitTaxAmount. */
export function splitTaxAmount(totalPaise: number, intraState: boolean) {
  if (intraState) {
    const half = Math.floor(totalPaise / 2);
    return { cgst: half, sgst: totalPaise - half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: totalPaise };
}
