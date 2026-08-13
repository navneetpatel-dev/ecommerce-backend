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
} as const;

/** Matches `product_variants.lowStockAt` default. */
export const VARIANT_LOW_STOCK_DEFAULT = 5;
