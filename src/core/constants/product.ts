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
} as const;
