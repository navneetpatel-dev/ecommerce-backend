import { toPaise } from '@modules/pricing/money';

/** An offer as the engine needs it; `categoryIds` already includes every sub-category. */
export type LiveCashbackOffer = {
  id: string;
  name: string;
  percent: number;
  maxCashback: number | null;
  minOrderValue: number;
  categoryIds: ReadonlySet<string>;
  paymentMethods: readonly string[];
};

export type CashbackOfferLine = {
  categoryId: string | null;
  /** What the customer pays for the line: after coupons, GST included. */
  paidPaise: number;
};

export type CashbackOfferResult = { offerId: string; name: string; amountPaise: number };

/** Cashback one offer gives on these lines, or 0 when the order does not qualify. */
export function offerCashbackPaise(
  offer: LiveCashbackOffer,
  lines: readonly CashbackOfferLine[],
  paymentMethod: string | undefined,
): number {
  if (offer.paymentMethods.length > 0 && (!paymentMethod || !offer.paymentMethods.includes(paymentMethod))) return 0;
  const qualifyingPaise = lines.reduce(
    (sum, line) =>
      offer.categoryIds.size === 0 || (line.categoryId && offer.categoryIds.has(line.categoryId))
        ? sum + Math.max(0, line.paidPaise)
        : sum,
    0,
  );
  if (qualifyingPaise <= 0 || qualifyingPaise < toPaise(offer.minOrderValue)) return 0;
  const raw = Math.floor((qualifyingPaise * Math.round(offer.percent * 100)) / 10_000);
  return offer.maxCashback == null ? raw : Math.min(raw, toPaise(offer.maxCashback));
}

/** The offer that gives the most cashback; offers never stack. Ties go to the first listed. */
export function bestCashbackOffer(
  offers: readonly LiveCashbackOffer[],
  lines: readonly CashbackOfferLine[],
  paymentMethod: string | undefined,
): CashbackOfferResult | null {
  let best: CashbackOfferResult | null = null;
  for (const offer of offers) {
    const amountPaise = offerCashbackPaise(offer, lines, paymentMethod);
    if (amountPaise > 0 && (!best || amountPaise > best.amountPaise)) {
      best = { offerId: offer.id, name: offer.name, amountPaise };
    }
  }
  return best;
}
