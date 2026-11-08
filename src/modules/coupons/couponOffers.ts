import { Op, literal } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { COUPON_STATUS } from '@core/constants/statuses';
import { validateCoupon, type CartLineForCoupon } from './couponEngine';
import { couponsReplacedBy, customerCouponName } from './coupon.utils';

/** Rows worth checking one by one, once the query has dropped what can't apply. */
const OFFER_CANDIDATE_LIMIT = 200;
/** Places kept for bundles the shopper has started, so better deals can't hide them. */
const INCOMPLETE_BUNDLE_SLOTS = 2;
/**
 * Places kept for deals that pay off at checkout, likewise: BOGO or a tier at one unit, or
 * free shipping before the address is known. One of each kind first, so two BOGOs can't
 * crowd out free shipping.
 */
const AT_CHECKOUT_SLOTS = 3;

function oneOfEachKindFirst(rows: RankedOffer[]): RankedOffer[] {
  const seen = new Set<string>();
  const first = rows.filter((row) => !seen.has(row.offer.type) && seen.add(row.offer.type));
  return [...first, ...rows.filter((row) => !first.includes(row))];
}
/** The seller's name rides along so two offers with the same name can be told apart. */
const sellerInclude = [{ model: Vendor, attributes: ['businessName'], required: false }];

function sellerNameOf(coupon: Coupon): string | null {
  const vendor = (coupon as unknown as { Vendor?: { businessName?: string | null } | null }).Vendor;
  return coupon.vendorId ? (vendor?.businessName ?? null) : null;
}

/** Best deal first: what the shopper gets (discount + cashback), then priority. */
function byCustomerValue(a: RankedOffer, b: RankedOffer): number {
  return b.value - a.value || b.offer.priority - a.offer.priority || b.createdAt - a.createdAt;
}

type RankedOffer = { offer: CouponOffer; value: number; createdAt: number; atCheckout: boolean };

export type CouponOffer = {
  code: string;
  name: string;
  type: string;
  discount: number;
  cashbackAmount: number;
  priority: number;
  /** Applied codes this offer would swap out. */
  replaces: string[];
  /** A bundle not yet complete: how many of its products are still missing (no Apply yet). */
  missingCount?: number;
  /** The vendor's name for a vendor's own coupon; null for the platform's. */
  sellerName: string | null;
};

const textArray = (values: string[]) =>
  `ARRAY[${values.map((value) => sequelize.escape(value)).join(',')}]::text[]`;

/** Only coupons that could apply to these lines, so unrelated ones can't use up the limit. */
function scopeMatchesLines(lines: CartLineForCoupon[]) {
  const unique = (values: Array<string | null | undefined>) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))];
  const products = textArray(unique(lines.map((line) => line.productId)));
  const categories = textArray(unique(lines.map((line) => line.categoryId)));
  const vendors = textArray(unique(lines.map((line) => line.vendorId)));
  const ids = `"applicableScope"->'ids'`;
  const type = `lower(COALESCE("applicableScope"->>'type', 'all'))`;
  return literal(`(
    ${type} = 'all'
    OR (${type} = 'product' AND jsonb_exists_any(${ids}, ${products}))
    OR (${type} = 'category' AND jsonb_exists_any(${ids}, ${categories}))
    OR (${type} = 'vendor' AND (jsonb_array_length(COALESCE(${ids}, '[]'::jsonb)) = 0 OR jsonb_exists_any(${ids}, ${vendors})))
  )`);
}

/**
 * The coupons to advertise for these lines. Never bulk codes or hidden coupons; a guest also
 * never sees a coupon meant for particular customers. These still work when typed.
 */
export async function listCouponOffers(input: {
  userId: string | null;
  lines: CartLineForCoupon[];
  shippingTotal: number;
  shippingByVendor: Record<string, number>;
  shippingUnknown?: boolean;
  limit: number;
  /** The product page advertises deals an item can reach (BOGO at one unit); the cart doesn't. */
  keepZeroBenefit: boolean;
  appliedCodes?: string[];
}): Promise<CouponOffer[]> {
  const now = new Date();
  const vendorIds = [...new Set(input.lines.map((line) => line.vendorId).filter(Boolean))] as string[];
  const conditions = [scopeMatchesLines(input.lines)];
  if (!input.userId) {
    conditions.push(literal(`lower(COALESCE("userRestriction"->>'type', 'all')) NOT IN ('specific', 'segment')`));
  }
  const candidates = await Coupon.findAll({
    where: {
      status: COUPON_STATUS.ACTIVE,
      showInOffers: true,
      batchId: null,
      startDate: { [Op.lte]: now },
      endDate: { [Op.gte]: now },
      vendorId: { [Op.or]: [null, { [Op.in]: vendorIds }] },
      [Op.and]: conditions,
    },
    include: sellerInclude,
    order: [
      ['priority', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: OFFER_CANDIDATE_LIMIT,
  });

  const appliedCodes = input.appliedCodes ?? [];
  const applied = appliedCodes.length
    ? await Coupon.findAll({
        where: { code: appliedCodes },
        attributes: ['code', 'stackable', 'vendorId'],
      })
    : [];

  // Every candidate is checked, then the best are kept: stopping at the first few in
  // priority order hid bigger savings further down.
  const ranked: RankedOffer[] = [];
  for (const coupon of candidates) {
    const result = await validateCoupon({
      coupon,
      userId: input.userId,
      lines: input.lines,
      shippingTotal: input.shippingTotal,
      shippingByVendor: input.shippingByVendor,
      shippingUnknown: input.shippingUnknown,
    });
    if (!result.valid) continue;
    // A ₹0 deal is still worth showing on a product page (BOGO at one unit), except free
    // shipping on an order that already ships free: that one can never give anything.
    const knownFreeShipping = coupon.type === 'FREE_SHIPPING' && !input.shippingUnknown;
    if (result.zeroBenefit && (!input.keepZeroBenefit || knownFreeShipping)) continue;
    ranked.push({
      value: Number(result.discount ?? 0) + Number(result.cashbackAmount ?? 0),
      atCheckout:
        (Boolean(result.zeroBenefit) && coupon.type !== 'FREE_SHIPPING') ||
        (coupon.type === 'FREE_SHIPPING' && Boolean(input.shippingUnknown)),
      createdAt: new Date(coupon.createdAt as unknown as string).getTime() || 0,
      offer: {
        code: coupon.code,
        name: customerCouponName(coupon),
        type: coupon.type,
        // Without an address the shipping isn't known, so no amount is promised.
        discount: coupon.type === 'FREE_SHIPPING' && input.shippingUnknown ? 0 : result.discount,
        cashbackAmount: result.cashbackAmount,
        priority: Number(coupon.priority ?? 0),
        replaces: couponsReplacedBy(coupon, applied).map((row) => row.code),
        sellerName: sellerNameOf(coupon),
      },
    });
  }
  const bundles = await incompleteBundleOffers(input, Math.min(INCOMPLETE_BUNDLE_SLOTS, input.limit));
  const sorted = ranked.sort(byCustomerValue);
  const atCheckout = oneOfEachKindFirst(sorted.filter((row) => row.atCheckout))
    .slice(0, AT_CHECKOUT_SLOTS)
    .map((row) => row.offer);
  const real = sorted.filter((row) => !row.atCheckout).map((row) => row.offer);
  const room = Math.max(0, input.limit - bundles.length - atCheckout.length);
  return [...real.slice(0, room), ...atCheckout, ...bundles].slice(0, input.limit);
}

/**
 * Bundles the shopper has started: they include an item here but not all of it yet, so
 * they'd never pass validation and would stay invisible. Listed with what's missing.
 */
async function incompleteBundleOffers(
  input: { userId: string | null; lines: CartLineForCoupon[] },
  limit: number,
): Promise<CouponOffer[]> {
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const vendorIds = [...new Set(input.lines.map((line) => line.vendorId).filter(Boolean))] as string[];
  const now = new Date();
  const conditions = [literal(`jsonb_exists_any(COALESCE(config->'bundleProductIds', '[]'::jsonb), ${textArray(productIds)})`)];
  if (!input.userId) {
    conditions.push(literal(`lower(COALESCE("userRestriction"->>'type', 'all')) NOT IN ('specific', 'segment')`));
  }
  const bundles = await Coupon.findAll({
    where: {
      type: 'BUNDLE',
      status: COUPON_STATUS.ACTIVE,
      showInOffers: true,
      batchId: null,
      startDate: { [Op.lte]: now },
      endDate: { [Op.gte]: now },
      vendorId: { [Op.or]: [null, { [Op.in]: vendorIds }] },
      [Op.and]: conditions,
    },
    include: sellerInclude,
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
    limit: OFFER_CANDIDATE_LIMIT,
  });
  const offers: CouponOffer[] = [];
  for (const coupon of bundles) {
    const restriction = coupon.userRestriction;
    if (restriction?.type === 'specific') {
      const allowed = Array.isArray(restriction.value) ? restriction.value : [restriction.value];
      if (!input.userId || !allowed.includes(input.userId)) continue;
    }
    const missing = (coupon.config?.bundleProductIds ?? []).filter((id) => !productIds.includes(String(id)));
    if (missing.length === 0) continue;
    const value = Number(coupon.value ?? 0);
    const cap = coupon.maxDiscountCap != null ? Number(coupon.maxDiscountCap) : value;
    offers.push({
      code: coupon.code,
      name: customerCouponName(coupon),
      type: coupon.type,
      discount: Math.min(value, cap),
      cashbackAmount: 0,
      priority: Number(coupon.priority ?? 0),
      replaces: [],
      missingCount: missing.length,
      sellerName: sellerNameOf(coupon),
    });
    if (offers.length >= limit) break;
  }
  return offers;
}
