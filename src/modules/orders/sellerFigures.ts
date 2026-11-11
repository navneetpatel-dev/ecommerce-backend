/**
 * Money that belongs to the seller and the platform, not the shopper: the
 * platform's commission, TCS withheld and the seller's payout, and their
 * reversals on a return. Shopper-facing responses drop these everywhere they
 * are nested (orders, parts, lines, returns).
 */
export const SELLER_ONLY_FIELDS = new Set([
  'commissionAmount',
  'commissionAmountPaise',
  'tcsAmount',
  'tcsAmountPaise',
  'netPayout',
  'netPayoutAmount',
  'netPayoutAmountPaise',
  'refundCommissionAmount',
  'refundTcsAmount',
  'refundNetClawbackAmount',
]);

export function withoutSellerFigures<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutSellerFigures(item)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  const model = value as unknown as { get?: unknown; toJSON?: () => Record<string, unknown> };
  const source =
    typeof model.get === 'function' && typeof model.toJSON === 'function'
      ? model.toJSON()
      : (value as unknown as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (SELLER_ONLY_FIELDS.has(key)) continue;
    out[key] = withoutSellerFigures(child);
  }
  return out as T;
}
