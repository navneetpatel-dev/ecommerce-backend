/** Product listing field limits — keep in sync with web `features/products/constants/productFields.ts`. */
export const PRODUCT_FIELD_LIMITS = {
  NAME_MAX: 200,
  DESCRIPTION_MAX: 8000,
  BRAND_MAX: 80,
  TAG_MAX: 40,
  TAGS_MAX: 20,
  HIGHLIGHT_MAX: 160,
  HIGHLIGHTS_MAX: 12,
  SPEC_KEY_MAX: 60,
  SPEC_VALUE_MAX: 200,
  SPECS_MAX: 30,
  NOTE_MAX: 500,
  HSN_MAX: 16,
  SEO_TITLE_MAX: 255,
  SEO_DESCRIPTION_MAX: 2000,
  WARRANTY_MONTHS_MAX: 120,
  /** Highest price or MRP (₹) a listing may carry. */
  PRICE_MAX: 10_000_000,
} as const;

/** Variant field limits and the written notes admins record. Keep in sync with web `productFields.ts`. */
export const VARIANT_LIMITS = {
  SKU_MAX: 64,
  ATTRIBUTES_MAX: 10,
  ATTRIBUTE_KEY_MAX: 40,
  ATTRIBUTE_VALUE_MAX: 80,
  STOCK_MAX: 1_000_000,
  LOW_STOCK_MAX: 100_000,
  WEIGHT_GRAMS_MAX: 1_000_000,
} as const;

/** Most images one product can carry (marketplace norm). Keep in sync with web `productFields.ts`. */
export const MAX_PRODUCT_IMAGES = 10;

/** Length bounds of the price-change reason and the vendor consent note. */
export const ADMIN_NOTE_LIMITS = { MIN: 10, MAX: 500 } as const;

/** Bounds for POST /products/bulk-import (synchronous, in-request processing). */
export const BULK_IMPORT_LIMITS = {
  MAX_ROWS: 500,
  MAX_FILE_BYTES: 2 * 1024 * 1024,
} as const;

/** Matches `product_variants.lowStockAt` default. */
export const VARIANT_LOW_STOCK_DEFAULT = 5;
