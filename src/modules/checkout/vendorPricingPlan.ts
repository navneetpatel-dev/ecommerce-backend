import type { Transaction } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import type { DiscountBearer } from '@core/constants/statuses';
import { Vendor } from '@database/models/vendor.model';
import { resolveVendorShippingQuote } from '@modules/shipping/vendorShippingQuote';
import { taxService } from '@modules/tax/tax.service';
import { categoriesService } from '@modules/categories/categories.service';
import { pricingService } from '@modules/pricing/pricing.service';
import { resolveVendorDiscountBearer } from '@modules/coupons/couponEngine';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';

/**
 * The single place a cart is grouped by vendor, priced, and run through PricingEngine.
 *
 * Cart preview, checkout quote and order creation all enter here so they cannot drift.
 * Lives in `checkout/` rather than `pricing/` because `shipping/vendorShippingQuote`
 * already imports from `pricing/`; putting this there would close an import cycle.
 */

/** Vendor bucket key for items with no vendor (first-party/marketplace stock). */
export const PLATFORM_VENDOR_ID = 'platform';

/** Normalized cart line — every caller maps its own row shape into this. */
export type PricedLine = {
  /** Stable per-line key; PricingEngine echoes it back on each line breakdown. */
  key: string;
  vendorId: string;
  unitPrice: number;
  quantity: number;
  categoryId: string | null;
  weightGrams: number | null;
};

export type LineRateMap = Record<string, { gstPercentage: number; commissionRatePercent: number }>;

export type VendorPricingRow = {
  vendorId: string;
  vendor: Vendor | null;
  lines: PricedLine[];
  shippingCost: number;
  /** False when no shipping rate matched — only possible with `onMissingRate: 'estimate'`. */
  shippingRateFound: boolean;
  gstPercentage: number;
  commissionRatePercent: number;
  lineRates: LineRateMap;
};

export type VendorPricingPlan = {
  rows: VendorPricingRow[];
  shippingByVendor: Record<string, number>;
  shippingTotal: number;
  /** True when any vendor fell back to an unmatched shipping rate. */
  hasEstimatedShipping: boolean;
};

export type DiscountShares = {
  vendorDiscountShares: Record<string, number>;
  vendorShippingDiscountShares: Record<string, number>;
  vendorBorneDiscountShares: Record<string, number>;
};

export function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
}

export function requestedMethod(method?: string): 'STANDARD' | 'EXPRESS' {
  const normalized = (method || 'STANDARD').toUpperCase();
  if (normalized !== 'STANDARD' && normalized !== 'EXPRESS') {
    throw new ValidationError(ERROR_MESSAGES.SHIPPING_METHOD_UNSUPPORTED);
  }
  return normalized;
}

export function vendorOriginState(vendor: Vendor | null | undefined): string {
  return String(vendor?.state ?? '').trim();
}

/** Resolve GST + commission rate per line, with the first line supplying engine fallbacks. */
async function resolveLineRates(
  lines: PricedLine[],
  vendor: Vendor | null,
  defaultCommissionRate: number,
): Promise<{ lineRates: LineRateMap; fallbackGst: number; fallbackCommission: number }> {
  const lineRates: LineRateMap = {};
  for (const line of lines) {
    const gstPercentage = line.categoryId ? await taxService.getGstRate(line.categoryId) : 0;
    const commissionRatePercent = line.categoryId
      ? await categoriesService.resolveCommissionRate(line.categoryId, vendor?.commissionRate, defaultCommissionRate)
      : defaultCommissionRate;
    lineRates[line.key] = { gstPercentage, commissionRatePercent };
  }
  const first = lines[0] ? lineRates[lines[0].key] : undefined;
  return {
    lineRates,
    fallbackGst: first?.gstPercentage ?? 0,
    fallbackCommission: first?.commissionRatePercent ?? defaultCommissionRate,
  };
}

/**
 * Group lines by vendor and resolve shipping + GST + commission for each bucket.
 *
 * `onMissingRate` is the only real difference between callers: checkout must reject an
 * unservable address, the cart preview must degrade to an estimate instead.
 */
export async function buildVendorPricingRows(input: {
  lines: PricedLine[];
  destination: { pincode: string; state: string } | null;
  shippingMethodByVendor: Record<string, string | undefined>;
  settings: PlatformSettingsPayload;
  onMissingRate: 'throw' | 'estimate';
  transaction?: Transaction;
}): Promise<VendorPricingPlan> {
  const linesByVendor = groupBy(input.lines, (line) => line.vendorId || PLATFORM_VENDOR_ID);
  const vendorIds = Object.keys(linesByVendor).filter((id) => id !== PLATFORM_VENDOR_ID);
  const vendors = vendorIds.length ? await Vendor.findAll({ where: { id: vendorIds }, transaction: input.transaction }) : [];
  const vendorMap = Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor]));

  const rows: VendorPricingRow[] = [];
  const shippingByVendor: Record<string, number> = {};
  let shippingTotal = 0;
  let hasEstimatedShipping = false;

  for (const [vendorId, lines] of Object.entries(linesByVendor)) {
    const vendor = vendorMap[vendorId] ?? null;
    const shipping = await resolveVendorShippingQuote({
      destination: input.destination,
      vendorId: vendorId !== PLATFORM_VENDOR_ID ? vendorId : null,
      method: requestedMethod(input.shippingMethodByVendor[vendorId]),
      lines: lines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        weightGrams: line.weightGrams,
      })),
    });
    if (!shipping.rate) {
      if (input.onMissingRate === 'throw') {
        throw new ValidationError(ERROR_MESSAGES.SHIPPING_RATE_UNAVAILABLE);
      }
      hasEstimatedShipping = true;
    }

    const shippingCost = shipping.shippingCost;
    const resolved = await resolveLineRates(lines, vendor, input.settings.defaultCommissionRate);

    shippingByVendor[vendorId] = shippingCost;
    shippingTotal += shippingCost;
    rows.push({
      vendorId,
      vendor,
      lines,
      shippingCost,
      shippingRateFound: Boolean(shipping.rate),
      gstPercentage: resolved.fallbackGst,
      commissionRatePercent: resolved.fallbackCommission,
      lineRates: resolved.lineRates,
    });
  }

  return { rows, shippingByVendor, shippingTotal, hasEstimatedShipping };
}

/** Apply coupon shares and run PricingEngine for each vendor bucket. */
export function priceVendorRows(input: {
  rows: VendorPricingRow[];
  shares: DiscountShares;
  shippingStateCode: string;
  settings: PlatformSettingsPayload;
}): {
  pricedByVendor: Record<string, ReturnType<typeof pricingService.computeVendorBreakdown>>;
  bearerByVendor: Record<string, DiscountBearer>;
  customerGrandTotalPaise: number;
} {
  const pricedByVendor: Record<string, ReturnType<typeof pricingService.computeVendorBreakdown>> = {};
  const bearerByVendor: Record<string, DiscountBearer> = {};
  let customerGrandTotalPaise = 0;

  for (const row of input.rows) {
    const merchandiseDiscount = input.shares.vendorDiscountShares[row.vendorId] ?? 0;
    const shippingDiscount = Math.min(row.shippingCost, input.shares.vendorShippingDiscountShares[row.vendorId] ?? 0);
    const vendorBorne = input.shares.vendorBorneDiscountShares[row.vendorId] ?? 0;
    const bearer = resolveVendorDiscountBearer(vendorBorne, merchandiseDiscount);
    bearerByVendor[row.vendorId] = bearer;

    const priced = pricingService.computeVendorBreakdown({
      lines: row.lines.map((line) => ({
        key: line.key,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        gstPercentage: row.lineRates[line.key]?.gstPercentage,
        commissionRatePercent: row.lineRates[line.key]?.commissionRatePercent,
      })),
      merchandiseDiscount,
      vendorBorneMerchandiseDiscount: vendorBorne,
      shippingDiscount,
      shippingCost: row.shippingCost,
      gstPercentage: row.gstPercentage,
      vendorStateCode: vendorOriginState(row.vendor),
      shippingStateCode: input.shippingStateCode || vendorOriginState(row.vendor),
      commissionRatePercent: row.commissionRatePercent,
      discountBearer: bearer,
      tcsRatePercent: input.settings.tcsRatePercent,
    });

    pricedByVendor[row.vendorId] = priced;
    customerGrandTotalPaise += priced.paise.customerTotalPaise;
  }

  return { pricedByVendor, bearerByVendor, customerGrandTotalPaise };
}
