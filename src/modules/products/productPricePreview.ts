import { productDiscountPercent, productShowMrp } from '@modules/pricing/displayMoney';
import { gstRateForPieces } from '@modules/pricing/pricing.engine';
import { fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { priceWithRuleGst } from '@modules/tax/gstPricing';
import { taxService } from '@modules/tax/tax.service';

export type CustomerPricePreview = {
  gstPercentage: number;
  /** What the customer pays for one piece, GST included. */
  displayPrice: number;
  compareAtPrice: number | null;
  /** Whether the customer page strikes the MRP through (it is above the price). */
  showMrp: boolean;
  /** The "% off" badge, or null when there is no discount to show. */
  discountPercent: number | null;
  /** MRP minus what the customer pays, when the MRP is shown. */
  savings: number | null;
  /** What the customer pays for each requested variant price, in the same order. */
  variantDisplayPrices: number[];
};

/**
 * What the customer page would show for a pre-GST `price` and an MRP, computed with the same
 * functions as the product page: the GST-inclusive price, the strikethrough MRP, the "% off" and
 * the saving. For the product form's live preview; nothing is saved.
 */
export async function previewCustomerPrice(
  categoryId: string,
  price: number,
  compareAtPrice: number | null,
  variantPrices: number[] = [],
): Promise<CustomerPricePreview> {
  const rule = await taxService.getGstRateRule(categoryId);
  const displayPrice = priceWithRuleGst(rule, price);
  const showMrp = productShowMrp(displayPrice, compareAtPrice);
  return {
    gstPercentage: gstRateForPieces(rule.gstPercentage, rule.gstPriceBand, toPaise(roundMoney(price)), 1),
    displayPrice,
    compareAtPrice: compareAtPrice == null ? null : roundMoney(compareAtPrice),
    showMrp,
    discountPercent: productDiscountPercent(displayPrice, compareAtPrice),
    variantDisplayPrices: variantPrices.map((variantPrice) => priceWithRuleGst(rule, variantPrice)),
    savings: showMrp && compareAtPrice != null ? fromPaise(toPaise(roundMoney(compareAtPrice)) - toPaise(displayPrice)) : null,
  };
}
