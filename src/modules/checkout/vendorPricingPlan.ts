import type { Transaction } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import type { DiscountBearer } from '@core/constants/statuses';
import { Vendor } from '@database/models/vendor.model';
import { resolveVendorShippingQuote } from '@modules/shipping/vendorShippingQuote';
import { taxService } from '@modules/tax/tax.service';
import { categoriesService } from '@modules/categories/categories.service';
import { pricingService } from '@modules/pricing/pricing.service';
import { resolveVendorDiscountBearer } from '@modules/coupons/couponEngine';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';
import type { GstPriceBand } from '@modules/pricing/pricing.engine';
import { fromPaise, toPaise, type Paise } from '@modules/pricing/money';
import { preGstDiscountPaise, priceWithRuleGst, type GstRatedLine } from '@modules/tax/gstPricing';

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

export type LineRateMap = Record<string, { gstPercentage: number; gstPriceBand: GstPriceBand | null; commissionRatePercent: number }>;

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
    const { gstPercentage, gstPriceBand } = line.categoryId
      ? await taxService.getGstRateRule(line.categoryId)
      : { gstPercentage: 0, gstPriceBand: null };
    const commissionRatePercent = line.categoryId
      ? await categoriesService.resolveCommissionRate(line.categoryId, vendor?.commissionRate, defaultCommissionRate)
      : defaultCommissionRate;
    lineRates[line.key] = { gstPercentage, gstPriceBand, commissionRatePercent };
  }
  const first = lines[0] ? lineRates[lines[0].key] : undefined;
  return {
    lineRates,
    fallbackGst: first?.gstPercentage ?? 0,
    fallbackCommission: first?.commissionRatePercent ?? defaultCommissionRate,
  };
}

/**
 * Each line's value as the customer sees it — GST included, before any coupon — in paise,
 * priced by the same engine pass the bill shows (`inclusiveByVendor`), so a threshold
 * checked against these agrees with the displayed items total to the paisa.
 */
export function gstInclusiveLinePaise(input: {
  lines: Array<{ unitPrice: number; quantity: number }>;
  rates: Array<{ gstPercentage: number; gstPriceBand: GstPriceBand | null }>;
  vendor: Vendor | null;
  shippingStateCode: string;
}): Paise[] {
  if (input.lines.length === 0) return [];
  const vendorStateCode = vendorOriginState(input.vendor);
  const gross = pricingService.computeVendorBreakdown({
    lines: input.lines.map((line, index) => ({
      key: String(index),
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      gstPercentage: input.rates[index]?.gstPercentage ?? 0,
      gstPriceBand: input.rates[index]?.gstPriceBand ?? null,
      commissionRatePercent: 0,
    })),
    merchandiseDiscount: 0,
    vendorBorneMerchandiseDiscount: 0,
    shippingDiscount: 0,
    shippingCost: 0,
    gstPercentage: input.rates[0]?.gstPercentage ?? 0,
    vendorStateCode,
    shippingStateCode: input.shippingStateCode || vendorStateCode,
    commissionRatePercent: 0,
    discountBearer: null,
    tcsRatePercent: 0,
  }).paise;
  return gross.lines.map((line) => line.taxablePaise + line.tax.total);
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
    const resolved = await resolveLineRates(lines, vendor, input.settings.defaultCommissionRate);
    // The free-shipping threshold is on what the customer pays for the items (GST
    // included), valued as the bill shows them.
    const inclusivePaise = gstInclusiveLinePaise({
      lines,
      rates: lines.map((line) => resolved.lineRates[line.key]!),
      vendor,
      shippingStateCode: input.destination?.state ?? '',
    });
    const shipping = await resolveVendorShippingQuote({
      destination: input.destination,
      vendorId: vendorId !== PLATFORM_VENDOR_ID ? vendorId : null,
      method: requestedMethod(input.shippingMethodByVendor[vendorId]),
      lines: lines.map((line, index) => ({
        unitPrice: priceWithRuleGst(resolved.lineRates[line.key]!, line.unitPrice),
        quantity: line.quantity,
        weightGrams: line.weightGrams,
        lineAmountPaise: inclusivePaise[index],
      })),
    });
    if (!shipping.rate) {
      if (input.onMissingRate === 'throw') {
        // Coded, not a generic VALIDATION_ERROR: the client maps this code to delivery-area
        // copy and sends the shopper back to the shipping step. A plain ValidationError left
        // that mapping dead and showed the raw sentence with no way to fix the address.
        throw new AppError(ERROR_MESSAGES.SHIPPING_RATE_UNAVAILABLE, 422, ERROR_CODES.SHIPPING_RATE_UNAVAILABLE);
      }
      hasEstimatedShipping = true;
    }

    const shippingCost = shipping.shippingCost;

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

/**
 * The items of one vendor bucket as the customer sees them, GST included: each line's
 * price per piece and line total before any coupon, and the bucket's items total.
 */
export type GstInclusiveItems = {
  itemsPaise: Paise;
  lines: Record<string, { unitPricePaise: Paise; lineTotalPaise: Paise }>;
};

/**
 * Apply coupon shares and run PricingEngine for each vendor bucket.
 *
 * Coupon shares are GST-inclusive (coupons discount the price the customer sees); the
 * engine takes its discount off the pre-GST value, so each vendor's share is converted
 * here — the one place every cart preview, quote and order goes through.
 */
export function priceVendorRows(input: {
  rows: VendorPricingRow[];
  shares: DiscountShares;
  shippingStateCode: string;
  settings: PlatformSettingsPayload;
}): {
  pricedByVendor: Record<string, ReturnType<typeof pricingService.computeVendorBreakdown>>;
  bearerByVendor: Record<string, DiscountBearer>;
  customerGrandTotalPaise: number;
  inclusiveByVendor: Record<string, GstInclusiveItems>;
} {
  const pricedByVendor: Record<string, ReturnType<typeof pricingService.computeVendorBreakdown>> = {};
  const bearerByVendor: Record<string, DiscountBearer> = {};
  const inclusiveByVendor: Record<string, GstInclusiveItems> = {};
  let customerGrandTotalPaise = 0;

  for (const row of input.rows) {
    const ratedLines: GstRatedLine[] = row.lines.map((line) => ({
      unitPricePaise: toPaise(line.unitPrice),
      quantity: line.quantity,
      gstPercentage: row.lineRates[line.key]?.gstPercentage ?? row.gstPercentage,
      gstPriceBand: row.lineRates[line.key]?.gstPriceBand ?? null,
    }));
    const inclusiveDiscountPaise = toPaise(input.shares.vendorDiscountShares[row.vendorId] ?? 0);
    const merchandiseDiscountPaise = preGstDiscountPaise(inclusiveDiscountPaise, ratedLines);
    // The vendor-funded part keeps its share of the discount.
    const vendorBornePaise =
      inclusiveDiscountPaise > 0
        ? Math.min(
            merchandiseDiscountPaise,
            Math.round(
              (merchandiseDiscountPaise * toPaise(input.shares.vendorBorneDiscountShares[row.vendorId] ?? 0)) / inclusiveDiscountPaise,
            ),
          )
        : 0;
    const merchandiseDiscount = fromPaise(merchandiseDiscountPaise);
    const vendorBorne = fromPaise(vendorBornePaise);
    const shippingDiscount = Math.min(row.shippingCost, input.shares.vendorShippingDiscountShares[row.vendorId] ?? 0);
    const bearer = resolveVendorDiscountBearer(vendorBorne, merchandiseDiscount);
    bearerByVendor[row.vendorId] = bearer;

    const base = {
      lines: row.lines.map((line) => ({
        key: line.key,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        gstPercentage: row.lineRates[line.key]?.gstPercentage,
        gstPriceBand: row.lineRates[line.key]?.gstPriceBand,
        commissionRatePercent: row.lineRates[line.key]?.commissionRatePercent,
      })),
      gstPercentage: row.gstPercentage,
      vendorStateCode: vendorOriginState(row.vendor),
      shippingStateCode: input.shippingStateCode || vendorOriginState(row.vendor),
      commissionRatePercent: row.commissionRatePercent,
      tcsRatePercent: input.settings.tcsRatePercent,
    };
    const priced = pricingService.computeVendorBreakdown({
      ...base,
      merchandiseDiscount,
      vendorBorneMerchandiseDiscount: vendorBorne,
      shippingDiscount,
      shippingCost: row.shippingCost,
      discountBearer: bearer,
    });

    // The same items with no coupon, priced by the same engine, so the GST-inclusive
    // figures the customer sees add up exactly to what they pay.
    const gross =
      merchandiseDiscountPaise > 0
        ? pricingService.computeVendorBreakdown({
            ...base,
            merchandiseDiscount: 0,
            vendorBorneMerchandiseDiscount: 0,
            shippingDiscount: 0,
            shippingCost: 0,
            discountBearer: bearer,
          }).paise
        : priced.paise;
    inclusiveByVendor[row.vendorId] = {
      itemsPaise: gross.taxablePaise + gross.tax.total,
      lines: Object.fromEntries(
        gross.lines.map((line, index) => [
          line.key,
          {
            unitPricePaise: toPaise(
              priceWithRuleGst(
                { gstPercentage: ratedLines[index]!.gstPercentage, gstPriceBand: ratedLines[index]!.gstPriceBand },
                row.lines[index]!.unitPrice,
              ),
            ),
            lineTotalPaise: line.taxablePaise + line.tax.total,
          },
        ]),
      ),
    };

    pricedByVendor[row.vendorId] = priced;
    customerGrandTotalPaise += priced.paise.customerTotalPaise;
  }

  return { pricedByVendor, bearerByVendor, customerGrandTotalPaise, inclusiveByVendor };
}
