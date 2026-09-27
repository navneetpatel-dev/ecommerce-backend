import { priceWithGst } from '@modules/pricing/displayMoney';
import { roundMoney, toPaise, type Paise } from '@modules/pricing/money';
import { gstRateForPieces, type GstPriceBand } from '@modules/pricing/pricing.engine';
import { taxService } from './tax.service';

/**
 * Prices are stored before GST; customers see them — and coupons, free-shipping
 * thresholds and COD limits are set — with GST included. These helpers move between
 * the two, the same way everywhere.
 */

export type GstRateRule = { gstPercentage: number; gstPriceBand: GstPriceBand | null };

/** A pre-GST price for one piece with GST at `rule` (its band rate when the price is above the band). */
export function priceWithRuleGst(rule: GstRateRule, price: unknown): number {
  const rate = gstRateForPieces(rule.gstPercentage, rule.gstPriceBand, toPaise(roundMoney(price)), 1);
  return priceWithGst(price, rate);
}

/** Resolves GST rules per category once — for pages and jobs that price many products. */
export function gstRuleResolver(): (categoryId: string | null | undefined) => Promise<GstRateRule> {
  const cache = new Map<string, Promise<GstRateRule>>();
  return (categoryId) => {
    const key = categoryId ?? '';
    let rule = cache.get(key);
    if (!rule) {
      rule = taxService.getGstRateRule(categoryId ?? undefined);
      cache.set(key, rule);
    }
    return rule;
  };
}

/** Lines with each unit price as the customer pays it (GST included), for coupon and threshold checks. */
export async function withGstInclusiveUnitPrices<T extends { categoryId: string | null; unitPrice: number }>(
  lines: T[],
  ruleFor: (categoryId: string | null | undefined) => Promise<GstRateRule> = gstRuleResolver(),
): Promise<T[]> {
  return Promise.all(
    lines.map(async (line) => ({ ...line, unitPrice: priceWithRuleGst(await ruleFor(line.categoryId), line.unitPrice) })),
  );
}

/** One line as the pricing engine sees it: pre-GST unit price and its GST rule. */
export type GstRatedLine = {
  unitPricePaise: Paise;
  quantity: number;
  gstPercentage: number;
  gstPriceBand: GstPriceBand | null;
};

/** The lines' value as the customer sees it (each piece with GST), in paise. */
export function gstInclusiveValuePaise(lines: GstRatedLine[]): Paise {
  return lines.reduce((sum, line) => {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    const piecePaise = toPaise(
      priceWithRuleGst({ gstPercentage: line.gstPercentage, gstPriceBand: line.gstPriceBand }, line.unitPricePaise / 100),
    );
    return sum + piecePaise * qty;
  }, 0);
}

/**
 * Coupons discount the GST-inclusive price the customer sees; the pricing engine takes
 * its discount off the pre-GST value and charges GST on what is left. This is the pre-GST
 * discount on a vendor's lines that takes `inclusivePaise` off what the customer pays
 * (the engine spreads it over the lines by value, so the ratio holds line by line).
 */
export function preGstDiscountPaise(inclusivePaise: Paise, lines: GstRatedLine[]): Paise {
  const amount = Math.max(0, Math.round(inclusivePaise));
  if (amount === 0) return 0;
  const preGst = lines.reduce(
    (sum, line) => sum + Math.max(0, Math.round(line.unitPricePaise)) * Math.max(0, Math.floor(Number(line.quantity) || 0)),
    0,
  );
  const inclusive = gstInclusiveValuePaise(lines);
  if (preGst <= 0 || inclusive <= 0) return Math.min(amount, preGst);
  return Math.min(preGst, Math.round((amount * preGst) / inclusive));
}
