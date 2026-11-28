import { loadCredentials } from '../../seed/credentials';

/** Logins from the seed's credentials file. The vendor, product and coupon ids below must be
 *  pointed at rows of the database under test before a run: a reseed gives rows new ids. */
const accounts = loadCredentials();

export const CREDENTIALS = {
  superAdmin: { email: accounts.superAdmin, password: accounts.passwords.superAdmin },
};

// One dedicated customer per scenario, so report deltas stay easy to attribute.
export const CUSTOMERS = {
  codSweep: accounts.customers[50]!,
  onlineCancel: accounts.customers[51]!,
  walletOnly: accounts.customers[52]!,
  hybrid: accounts.customers[53]!,
  multiVendor: accounts.customers[54]!,
  coupon: accounts.customers[55]!,
};
export const CUSTOMER_PASSWORD = accounts.passwords.customer;
export const VENDOR_PASSWORD = accounts.passwords.vendor;

// Vendors with confirmed distinct states, for the intra-/inter-state scenario.
// commissionRatePercent values are read live from vendors.commissionRate (verified via direct
// DB query) — do not assume a uniform platform default, each vendor can have its own override.
export const VENDORS = {
  techworld: {
    email: accounts.vendors[0]!,
    id: '695ca6a7-3164-4bd9-a14f-a552bd069f29',
    state: 'Karnataka',
    commissionRatePercent: 12,
  },
  fashionhub: {
    email: accounts.vendors[1]!,
    id: '7123bd69-5447-4004-9782-3a8f663378b0',
    state: 'Maharashtra',
    commissionRatePercent: 12.5,
  },
  // Delhi-based — used for scenario 05's intra-state leg (shipping to Delhi is the one
  // pincode/vendor combination confirmed to actually have a configured shipping rate for
  // both this vendor and TechWorld; several other vendor/Karnataka-pincode combinations
  // returned "No shipping rate is available" — a real shipping-config data gap, unrelated
  // to tax/commission calculation, so scenario 05 routes around it rather than chasing it).
  homestyle: {
    email: accounts.vendors[2]!,
    id: 'c3b413cc-e799-4ea7-99ca-4acd4aada30e',
    state: 'Delhi',
    commissionRatePercent: 18,
  },
};

// Real in-stock (LIVE) product variants, confirmed live against the seeded DB.
export const PRODUCTS = {
  // TechWorld (Karnataka), 18% GST — general-purpose item for COD sweep, coupon, multi-vendor A
  decorPro7: {
    variantId: 'cb15c463-da68-4954-81d0-31473cc469f8',
    vendorId: VENDORS.techworld.id,
    price: 2395.93,
    gstPercentage: 18,
  },
  // TechWorld (Karnataka), 5% GST — cheap item for wallet-only scenario
  jacketsElite48: {
    variantId: 'a8f7e308-38e5-4627-9d35-de21c12f6438',
    vendorId: VENDORS.techworld.id,
    price: 358.36,
    gstPercentage: 5,
  },
  // FashionHub (Maharashtra), 28% GST — used for online-cancel and multi-vendor B
  audioElite10: {
    variantId: '4a8f07bd-abc5-43a3-adf9-c69c6a91a6d0',
    vendorId: VENDORS.fashionhub.id,
    price: 1710.82,
    gstPercentage: 28,
  },
  // FashionHub (Maharashtra), 28% GST — used for hybrid scenario
  beddingElite24: {
    variantId: '85f4cb3b-5397-458e-8804-9f0ff4df19e6',
    vendorId: VENDORS.fashionhub.id,
    price: 1039.9,
    gstPercentage: 28,
  },
  // HomeStyle (Delhi), 28% GST — used for multi-vendor scenario's intra-state (Delhi) leg
  audioClassic16: {
    variantId: 'faa95e0f-780e-47c9-b1c1-1709c9bc1a84',
    vendorId: VENDORS.homestyle.id,
    price: 1368.89,
    gstPercentage: 28,
  },
};

export const COUPONS = {
  platformPercent: 'CS-COUPON-PLATFORM-10',
  vendorFlat: 'CS-COUPON-VENDOR-FLAT',
};
