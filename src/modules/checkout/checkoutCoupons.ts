import type { Transaction } from 'sequelize';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import type { CashbackBreakdownEntry, CouponLineSnapshot } from '@database/models/order.model';
import type { Coupon } from '@database/models/coupon.model';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
} from '@core/constants/statuses';
import { toPaise } from '@modules/pricing/money';
import { lineAmount } from '@modules/coupons/coupon.utils';
import { evaluateCartCoupons } from '@modules/coupons/couponCartState';
import {
  resolveCartCouponCodes,
  type CartLineForCoupon,
  type ValidateCouponSetResult,
} from '@modules/coupons/couponEngine';
import { PLATFORM_VENDOR_ID } from './vendorPricingPlan';

/**
 * The codes to price with. A list sent by the client is final, even an empty one. A client
 * that sends none (older app) gets the cart's coupons that apply right now, so one that has
 * since stopped working doesn't block its checkout.
 */
export async function resolveCheckoutCouponCodes(
  data: { couponCode?: string | null; couponCodes?: string[] },
  cart: { couponCode?: string | null; couponCodes?: string[] | null },
  context: { userId: string; lines: () => Promise<CartLineForCoupon[]>; shippingTotal: number; shippingByVendor: Record<string, number> },
): Promise<string[]> {
  if (data.couponCodes) {
    return [...new Set(data.couponCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  }
  if (data.couponCode?.trim()) {
    return [data.couponCode.trim().toUpperCase()];
  }
  const codes = resolveCartCouponCodes(cart);
  if (codes.length === 0) return [];
  const { result } = await evaluateCartCoupons({
    codes,
    userId: context.userId,
    lines: await context.lines(),
    shipping: { total: context.shippingTotal, byVendor: context.shippingByVendor },
  });
  return result.coupons.map((coupon) => coupon.code);
}

/** Each cashback coupon keeps its own payer and the lines it was earned on. */
export function buildCashbackBreakdown(
  perCoupon: ValidateCouponSetResult['perCoupon'],
): CashbackBreakdownEntry[] {
  return perCoupon
    .filter((entry) => entry.cashbackAmount > 0)
    .map((entry) => ({
      couponId: entry.couponId,
      code: entry.code,
      vendorId: entry.vendorId,
      bearer: entry.vendorId ? DISCOUNT_BEARER.VENDOR : DISCOUNT_BEARER.PLATFORM,
      amountPaise: toPaise(entry.cashbackAmount),
      creditedPaise: null,
      lines: entry.eligibleLines.map((line) => ({
        variantId: String(line.variantId),
        vendorId: line.vendorId,
        basePaise: toPaise(lineAmount(line)),
        quantity: Number(line.quantity),
      })),
    }));
}

type OfferRow = { vendorId: string; lines: Array<{ key: string; variantId?: string; quantity: number }> };
type OfferPrices = Record<string, { paise: { lines: Array<{ key: string; taxablePaise: number; tax: { total: number } }> } }>;

/**
 * The platform's cashback offer as one more entry, platform-funded and earned across the
 * order's lines, so it is credited, and taken back on returns, like a coupon's cashback.
 */
export function withOfferCashback(
  breakdown: CashbackBreakdownEntry[],
  offer: { offerId: string; name: string; amount: number },
  rows: OfferRow[],
  priced: OfferPrices,
): CashbackBreakdownEntry[] {
  const lines = rows.flatMap((row) =>
    row.lines.map((line) => {
      const paid = priced[row.vendorId]?.paise.lines.find((entry) => entry.key === line.key);
      return {
        variantId: String(line.variantId),
        vendorId: row.vendorId === PLATFORM_VENDOR_ID ? null : row.vendorId,
        basePaise: paid ? paid.taxablePaise + paid.tax.total : 0,
        quantity: Number(line.quantity),
      };
    }),
  );
  return [
    ...breakdown,
    {
      couponId: offer.offerId,
      code: offer.name,
      vendorId: null,
      bearer: DISCOUNT_BEARER.PLATFORM,
      amountPaise: toPaise(offer.amount),
      creditedPaise: null,
      lines,
    },
  ];
}

/**
 * A vendor's own free-shipping coupon: they fund the shipping it waived. An adjustment row,
 * so cancelling the part removes it with the part's other pending ledgers.
 */
export async function chargeVendorForFreeShipping(input: {
  vendorId: string;
  subOrderId: string;
  sharePaise: number;
  shippingDiscountPaise: number;
  transaction: Transaction;
}): Promise<void> {
  const amountPaise = Math.min(input.sharePaise, input.shippingDiscountPaise);
  if (amountPaise <= 0) return;
  await CommissionLedger.create(
    {
      vendorId: input.vendorId,
      subOrderId: input.subOrderId,
      commissionRate: 0,
      discountBearer: DISCOUNT_BEARER.VENDOR,
      saleAmountPaise: 0,
      commissionAmountPaise: -amountPaise,
      taxableAmountPaise: 0,
      discountAmountPaise: 0,
      taxAmountPaise: 0,
      tcsAmountPaise: 0,
      netPayoutAmountPaise: -amountPaise,
      shippingCollectedPaise: 0,
      referenceType: COMMISSION_REFERENCE_TYPE.SHIPPING_COUPON_COST,
      status: COMMISSION_STATUS.PENDING,
    },
    { transaction: input.transaction },
  );
}

/** Coupons whose worth depends on what's bought: a return has to re-check them. */
function isConditionalOffer(coupon: Coupon): boolean {
  return ['BOGO', 'BUNDLE', 'TIERED'].includes(coupon.type) || coupon.minOrderValue != null || coupon.minQuantity != null;
}

/** Each conditional coupon's terms and discount per line, frozen with the order. */
export function buildCouponLineSnapshot(
  perCoupon: ValidateCouponSetResult['perCoupon'],
  coupons: Coupon[],
): CouponLineSnapshot[] {
  return perCoupon.flatMap((entry) => {
    const coupon = coupons.find((row) => row.code === entry.code);
    if (!coupon || entry.freeShipping || entry.discount <= 0 || !isConditionalOffer(coupon)) return [];
    return [{
      couponId: coupon.id,
      type: coupon.type,
      value: coupon.value == null ? null : Number(coupon.value),
      maxDiscountCap: coupon.maxDiscountCap == null ? null : Number(coupon.maxDiscountCap),
      minOrderValue: coupon.minOrderValue == null ? null : Number(coupon.minOrderValue),
      minQuantity: coupon.minQuantity == null ? null : Number(coupon.minQuantity),
      config: coupon.config ?? {},
      vendorId: coupon.vendorId ?? null,
      takenPaise: 0,
      lines: entry.eligibleLines.map((line) => ({
        variantId: String(line.variantId),
        productId: line.productId,
        vendorId: line.vendorId,
        unitPaise: toPaise(line.unitPrice),
        quantity: Number(line.quantity),
        discountPaise: entry.lineShares[String(line.variantId)] ?? 0,
      })),
    }];
  });
}
