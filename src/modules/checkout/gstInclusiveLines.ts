import { Vendor } from '@database/models/vendor.model';
import type { CartLineForCoupon } from '@modules/coupons/coupon.utils';
import { gstRuleResolver, priceWithRuleGst } from '@modules/tax/gstPricing';
import { PLATFORM_VENDOR_ID, gstInclusiveLinePaise } from './vendorPricingPlan';

/**
 * Coupon lines at the prices the customer sees (GST included): each piece's price with
 * GST, and each line valued exactly as the bill shows it (`lineAmountPaise`, the engine's
 * per-line GST), so a coupon's minimum order value and a free-shipping threshold agree
 * with the displayed items total to the paisa. `shippingStateCode` decides CGST+SGST vs
 * IGST as the bill does ('' when there is no address: the seller's own state).
 */
export async function withGstInclusiveLineValues<T extends CartLineForCoupon>(
  lines: T[],
  shippingStateCode: string,
): Promise<T[]> {
  if (lines.length === 0) return lines;
  const ruleFor = gstRuleResolver();
  const rules = await Promise.all(lines.map((line) => ruleFor(line.categoryId)));

  const indicesByVendor = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const vendorId = line.vendorId ?? PLATFORM_VENDOR_ID;
    indicesByVendor.set(vendorId, [...(indicesByVendor.get(vendorId) ?? []), index]);
  });
  const vendorIds = [...indicesByVendor.keys()].filter((id) => id !== PLATFORM_VENDOR_ID);
  const vendors = vendorIds.length ? await Vendor.findAll({ where: { id: vendorIds } }) : [];
  const vendorById = new Map(vendors.map((vendor) => [String(vendor.id), vendor]));

  const lineAmountPaise = new Array<number>(lines.length).fill(0);
  for (const [vendorId, indices] of indicesByVendor) {
    const values = gstInclusiveLinePaise({
      lines: indices.map((index) => lines[index]!),
      rates: indices.map((index) => rules[index]!),
      vendor: vendorById.get(vendorId) ?? null,
      shippingStateCode,
    });
    indices.forEach((index, position) => {
      lineAmountPaise[index] = values[position] ?? 0;
    });
  }

  return lines.map((line, index) => ({
    ...line,
    unitPrice: priceWithRuleGst(rules[index]!, line.unitPrice),
    lineAmountPaise: lineAmountPaise[index],
  }));
}
