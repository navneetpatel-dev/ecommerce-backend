import { roundMoney, sumRupees } from '@modules/pricing/money';
import { type CartLineForCoupon } from '@modules/coupons/coupon.utils';
import { shippingService } from '@modules/shipping/shipping.service';
import { resolveVendorShippingQuote } from '@modules/shipping/vendorShippingQuote';
import { Address } from '@database/models/address.model';

export type CouponShippingPreview = {
  total: number;
  byVendor: Record<string, number>;
};

/** Cart/pincode-aware shipping total for coupon validation (no coupon service import). */
export async function resolveCartShippingPreviewForCoupon(
  userId: string | null,
  lines: CartLineForCoupon[],
): Promise<CouponShippingPreview> {
  if (!userId || lines.length === 0) return { total: 0, byVendor: {} };

  const address = await Address.findOne({
    where: { userId },
    order: [
      ['isDefault', 'DESC'],
      ['updatedAt', 'DESC'],
    ],
  });
  if (!address?.pincode) {
    return {
      total: 0,
      byVendor: Object.fromEntries([...new Set(lines.map((line) => line.vendorId ?? 'platform'))].map((vendorId) => [vendorId, 0])),
    };
  }

  const byVendor = new Map<string, CartLineForCoupon[]>();
  for (const line of lines) {
    const vendorId = line.vendorId ?? 'platform';
    const list = byVendor.get(vendorId) ?? [];
    list.push(line);
    byVendor.set(vendorId, list);
  }

  const byVendorShipping: Record<string, number> = {};
  for (const [vendorId, vendorLines] of byVendor) {
    const shipping = await resolveVendorShippingQuote({
      destination: {
        pincode: String(address.pincode).trim(),
        state: String(address.state ?? '').trim(),
      },
      vendorId: vendorId !== 'platform' ? vendorId : null,
      method: 'STANDARD',
      lines: vendorLines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        weightGrams: line.weightGrams,
      })),
    });
    byVendorShipping[vendorId] = shipping.shippingCost;
  }

  return {
    total: sumRupees(Object.values(byVendorShipping)),
    byVendor: byVendorShipping,
  };
}

/** Product/pincode-aware shipping estimate for PDP coupon eligibility. */
export async function resolveProductShippingPreviewForCoupon(
  userId: string | null,
  productId: string,
  variantId: string | undefined,
  vendorId: string | null,
): Promise<CouponShippingPreview | null> {
  if (!userId) return null;

  const address = await Address.findOne({
    where: { userId },
    order: [
      ['isDefault', 'DESC'],
      ['updatedAt', 'DESC'],
    ],
  });
  if (!address?.pincode) return null;

  const rates = await shippingService.quotePublicRates({
    pincode: String(address.pincode).trim(),
    state: String(address.state ?? '').trim(),
    productId,
    variantId,
  });
  const rate = rates.find((candidate) => candidate.method === 'STANDARD') ?? rates[0];
  const cost = rate ? roundMoney(rate.cost) : 0;
  return { total: cost, byVendor: { [vendorId ?? 'platform']: cost } };
}
