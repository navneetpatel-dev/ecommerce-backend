/**
 * Promotions: platform coupons (standalone and from 100 generated batches), 100+ coupons
 * for every selling vendor, 100 platform cashback offers in every state, and 100 home
 * promo banners. Every coupon type and status appears.
 */
import { HISTORY_DAYS, addDays, between, chance, daysAgo, id, insert, int, json, pgArray, pick, sample, select, weighted } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';
import type { Catalog } from './catalog';

export const VENDOR_COUPONS_PER_VENDOR = scaled(105, 5);
const PLATFORM_COUPONS = scaled(100, 10);
const BATCHES = scaled(100, 5);
const CASHBACK_OFFERS = scaled(100, 8);
const BANNERS = scaled(100, 8);

export type CouponRow = {
  id: string;
  code: string;
  type: string;
  value: number | null;
  maxDiscountCap: number | null;
  vendorId: string | null;
  discountBearer: string;
  startDate: Date;
  endDate: Date;
  status: string;
};

type Window = { startDate: Date; endDate: Date; status: string };

/** Dates that match the status: live now, scheduled, ended, or set aside. */
function couponWindow(): Window {
  const status = weighted([['ACTIVE', 50], ['EXPIRED', 25], ['PAUSED', 8], ['DRAFT', 7], ['ARCHIVED', 6], ['REJECTED', 4]] as const);
  if (status === 'ACTIVE') {
    // Most live coupons have run for months, so orders across the history can use them.
    const start = chance(0.1) ? daysAgo(-int(1, 20)) : daysAgo(int(30, HISTORY_DAYS));
    return { startDate: start, endDate: daysAgo(-int(20, 180)), status };
  }
  const start = daysAgo(int(60, HISTORY_DAYS));
  return { startDate: start, endDate: status === 'EXPIRED' ? addDays(start, int(15, 50)) : daysAgo(-int(10, 90)), status };
}

function couponFields(type: string) {
  switch (type) {
    case 'PERCENTAGE':
      return { value: pick([5, 10, 15, 20, 25]), maxDiscountCap: pick([100, 200, 300, 500]) };
    case 'FLAT':
      return { value: pick([50, 100, 150, 200, 250]), maxDiscountCap: null };
    case 'CASHBACK':
      return { value: pick([5, 10, 15]), maxDiscountCap: pick([100, 150, 250]) };
    case 'TIERED':
      return { value: null, maxDiscountCap: 600, config: { tiers: [{ minSubtotal: 999, percent: 5 }, { minSubtotal: 2999, percent: 10 }, { minSubtotal: 4999, percent: 15 }] } };
    case 'BOGO':
      return { value: null, maxDiscountCap: null, minQuantity: 2 };
    default:
      return { value: null, maxDiscountCap: null };
  }
}

function couponRow(code: string, type: string, base: Record<string, unknown>) {
  const window = couponWindow();
  const fields = couponFields(type) as Record<string, unknown>;
  return {
    id: id(), code, type, minOrderValue: pick([0, 299, 499, 999]), minQuantity: (fields.minQuantity as number | undefined) ?? null,
    applicableScope: json({ type: 'all', ids: [] }), excludedItems: json({ productIds: [], categoryIds: [] }),
    userRestriction: json(pick([{ type: 'all' }, { type: 'all' }, { type: 'firstOrder' }, { type: 'segment', value: pick(['new', 'returning', 'loyal']) }])),
    usageLimitTotal: pick([500, 1000, 5000, null]), usageLimitPerUser: pick([1, 2, 3, 5]), usedCount: 0,
    stackable: chance(0.2), priority: int(0, 10), discountBearer: 'PLATFORM', vendorId: null,
    value: fields.value ?? null, maxDiscountCap: fields.maxDiscountCap ?? null, config: json(fields.config ?? {}),
    ...window, createdAt: window.startDate < daysAgo(0) ? addDays(window.startDate, -int(1, 10)) : daysAgo(1), updatedAt: window.startDate,
    ...base,
  };
}

async function seedCoupons(accounts: Accounts, catalog: Catalog) {
  const codes = new Set((await select<{ code: string }>('SELECT code FROM coupons')).map((row) => row.code));
  const unique = (stem: string) => {
    let code = stem;
    for (let n = 2; codes.has(code); n += 1) code = `${stem}${n}`;
    codes.add(code);
    return code;
  };
  const platformTypes = ['PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'CASHBACK', 'TIERED', 'BOGO', 'BUNDLE'];
  const rows: Array<Record<string, unknown>> = [];
  const words = ['SAVE', 'DEAL', 'FEST', 'MEGA', 'HAPPY', 'SUPER', 'WEEKEND', 'FLASH', 'GRAND', 'PRIME'];
  for (let i = 0; i < PLATFORM_COUPONS; i += 1) {
    const type = platformTypes[i % platformTypes.length]!;
    const row = couponRow(unique(`${pick(words)}${int(10, 99)}`), type, { createdById: pick(accounts.adminIds) });
    if (type === 'BUNDLE') {
      row.value = 10;
      row.config = json({ bundleProductIds: sample(catalog.liveProductIds, 3) });
    }
    rows.push(row);
  }

  const batches: Array<Record<string, unknown>> = [];
  for (let b = 0; b < BATCHES; b += 1) {
    const batchId = id();
    const type = pick(['PERCENTAGE', 'FLAT']);
    const createdAt = daysAgo(int(10, HISTORY_DAYS));
    const generated = int(2, 4);
    batches.push({ id: batchId, name: `${pick(['Diwali', 'Holi', 'Monsoon', 'Republic Day', 'New Year', 'Partner', 'Influencer'])} batch ${b + 1}`, templateCouponConfig: json({ type, ...couponFields(type) }), generatedCount: generated, createdById: pick(accounts.adminIds), createdAt, updatedAt: createdAt });
    for (let g = 0; g < generated; g += 1) {
      rows.push(couponRow(unique(`B${b + 1}X${g + 1}${int(100, 999)}`), type, { createdById: pick(accounts.adminIds), batchId, usageLimitTotal: 1, usageLimitPerUser: 1 }));
    }
  }

  // Vendor coupons: on the vendor's own products, funded by the vendor.
  const vendorTypes = ['PERCENTAGE', 'FLAT', 'CASHBACK', 'FREE_SHIPPING', 'BOGO', 'TIERED'];
  for (const vendor of accounts.sellingVendors) {
    const stem = vendor.slug.replace(/-/g, '').slice(0, 6).toUpperCase();
    for (let i = 0; i < VENDOR_COUPONS_PER_VENDOR; i += 1) {
      const type = vendorTypes[i % vendorTypes.length]!;
      rows.push(couponRow(unique(`${stem}${i + 1}`), type, {
        createdById: vendor.ownerId, vendorId: vendor.id, discountBearer: 'VENDOR',
        applicableScope: json({ type: 'vendor', ids: [vendor.id] }),
      }));
    }
  }
  await insert('coupon_batches', batches);
  await insert('coupons', rows.map((row) => ({ ...row, status: (row.endDate as Date) < new Date() && row.status === 'ACTIVE' ? 'EXPIRED' : row.status })));
}

async function seedCashbackOffers(accounts: Accounts, catalog: Catalog) {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < CASHBACK_OFFERS; i += 1) {
    // Few live at once (checkout applies the best one); the rest scheduled, ended or off.
    const state = i < 6 ? 'LIVE' : weighted([['SCHEDULED', 2], ['ENDED', 5], ['OFF', 2]] as const);
    // Two always-on offers span the whole history, so every paid order earned cashback.
    if (i < 2) {
      const startsAt = daysAgo(HISTORY_DAYS + 20);
      rows.push({
        id: id(), name: i === 0 ? '2% back on every order' : '5% back on orders above ₹999', percent: i === 0 ? 2 : 5,
        maxCashback: i === 0 ? 100 : 150, minOrderValue: i === 0 ? 0 : 999, categoryIds: pgArray([]), paymentMethods: pgArray([]),
        startsAt, endsAt: null, isActive: true, createdBy: pick(accounts.adminIds), updatedBy: pick(accounts.adminIds),
        createdAt: startsAt, updatedAt: startsAt,
      });
      continue;
    }
    const startsAt = state === 'SCHEDULED' ? daysAgo(-int(3, 60)) : daysAgo(state === 'LIVE' ? int(30, HISTORY_DAYS) : int(60, HISTORY_DAYS));
    const endsAt = state === 'ENDED' ? addDays(startsAt, int(7, 40)) : chance(0.5) ? daysAgo(-int(30, 200)) : null;
    const percent = pick([2, 3, 5, 5, 7.5, 10]);
    const scoped = chance(0.4);
    rows.push({
      id: id(), name: `${percent}% back${scoped ? ' on select categories' : ''}${i % 4 === 0 ? ' with online payment' : ''}`,
      percent, maxCashback: pick([50, 100, 150, 250, null]), minOrderValue: pick([0, 499, 999, 1999]),
      categoryIds: pgArray(scoped ? sample(catalog.leaves, int(1, 4)).map((leaf) => leaf.id) : []),
      paymentMethods: pgArray(i % 4 === 0 ? ['RAZORPAY'] : i % 9 === 0 ? ['COD'] : []),
      startsAt, endsAt, isActive: state !== 'OFF', createdBy: pick(accounts.adminIds), updatedBy: pick(accounts.adminIds),
      createdAt: addDays(startsAt, -int(1, 7)), updatedAt: startsAt,
    });
  }
  await insert('cashback_offers', rows);
}

async function seedBanners(accounts: Accounts, catalog: Catalog) {
  const rows: Array<Record<string, unknown>> = [];
  const titles = ['Festive mega sale', 'New arrivals this week', 'Up to 60% off electronics', 'Home makeover days', 'Fitness fortnight', 'Beauty bonanza', 'Back to school', 'Weekend flash deals', 'Top brands, best prices', 'Gifts for every budget'];
  for (let i = 0; i < BANNERS; i += 1) {
    const status = i < 12 ? 'ACTIVE' : weighted([['ACTIVE', 1], ['DRAFT', 3], ['ARCHIVED', 5]] as const);
    const linkType = pick(['PRODUCT', 'CATEGORY', 'VENDOR', 'URL'] as const);
    const target = linkType === 'PRODUCT' ? pick(catalog.liveProductIds) : linkType === 'CATEGORY' ? pick(catalog.leaves).id : linkType === 'VENDOR' ? pick(accounts.sellingVendors).id : null;
    const startDate = status === 'ARCHIVED' ? daysAgo(int(60, HISTORY_DAYS)) : daysAgo(int(0, 30));
    rows.push({
      id: id(), title: `${pick(titles)} ${i + 1}`, imageUrl: `https://picsum.photos/seed/banner-${i}/1600/500`,
      linkType, linkTargetId: target, linkUrl: linkType === 'URL' ? '/products?sort=newest' : null,
      startDate, endDate: status === 'ARCHIVED' ? addDays(startDate, int(5, 30)) : chance(0.5) ? daysAgo(-int(10, 90)) : null,
      status, priority: int(0, 100), createdAt: between(addDays(startDate, -10), startDate), updatedAt: startDate,
    });
  }
  await insert('promo_banners', rows);
}

export async function seedPromotions(accounts: Accounts, catalog: Catalog): Promise<CouponRow[]> {
  await seedCoupons(accounts, catalog);
  await seedCashbackOffers(accounts, catalog);
  await seedBanners(accounts, catalog);
  return (await select<CouponRow & { value: string | null; maxDiscountCap: string | null }>(
    `SELECT id, code, type::text, value::text, "maxDiscountCap"::text, "vendorId", "discountBearer"::text, "startDate", "endDate", status::text FROM coupons`,
  )).map((row) => ({ ...row, value: row.value == null ? null : Number(row.value), maxDiscountCap: row.maxDiscountCap == null ? null : Number(row.maxDiscountCap) }));
}
