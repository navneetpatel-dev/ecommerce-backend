import type { Transaction } from 'sequelize';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { fromPaise } from '@modules/pricing/money';
import { bestCashbackOffer, type CashbackOfferLine } from './cashbackOfferEngine';
import { cashbackOffersService } from './cashbackOffers.service';

type PricedLine = { key: string; taxablePaise: number; tax: { total: number } };

export type CheckoutCashbackOffer = { offerId: string; name: string; amount: number };

/**
 * The platform cashback offer this checkout gets, on top of any coupon cashback.
 *
 * Not with a vendor-funded cashback coupon: the order has one cashback bearer, and the
 * vendor would otherwise be charged for the platform's offer when the cashback is credited.
 */
export async function checkoutCashbackOffer(input: {
  pricedByVendor: Record<string, { paise: { lines: PricedLine[] } }>;
  categoryOf: (lineKey: string) => string | null;
  paymentMethod?: string;
  coupons: ReadonlyArray<{ type: string; discountBearer?: string | null }>;
  transaction?: Transaction;
}): Promise<CheckoutCashbackOffer | null> {
  const vendorFundedCashback = input.coupons.some(
    (coupon) => coupon.type === 'CASHBACK' && coupon.discountBearer === DISCOUNT_BEARER.VENDOR,
  );
  if (vendorFundedCashback) return null;
  const offers = await cashbackOffersService.live(input.transaction);
  if (offers.length === 0) return null;
  const lines: CashbackOfferLine[] = Object.values(input.pricedByVendor).flatMap((priced) =>
    priced.paise.lines.map((line) => ({
      categoryId: input.categoryOf(line.key),
      paidPaise: line.taxablePaise + line.tax.total,
    })),
  );
  const best = bestCashbackOffer(offers, lines, input.paymentMethod);
  return best ? { offerId: best.offerId, name: best.name, amount: fromPaise(best.amountPaise) } : null;
}
