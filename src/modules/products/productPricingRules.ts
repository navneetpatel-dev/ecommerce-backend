/**
 * Fields that set what a product costs the customer or how it is taxed and paid for. Vendor staff
 * keep editing everything else (name, description, images, stock, tags…); changing these is
 * owner-only (and platform-admin).
 */
export const PRICING_PRODUCT_FIELDS = ['basePrice', 'compareAtPrice', 'hsnCode', 'codEnabled'] as const;

type PricingField = (typeof PRICING_PRODUCT_FIELDS)[number];

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** How each field is compared: money numerically, the HSN code as text (a leading zero matters), COD as a flag. */
const COMPARE: Record<PricingField, (a: unknown, b: unknown) => boolean> = {
  basePrice: (a, b) => Number(a) === Number(b),
  compareAtPrice: (a, b) => Number(a) === Number(b),
  hsnCode: (a, b) => String(a).trim() === String(b).trim(),
  codEnabled: (a, b) => Boolean(a) === Boolean(b),
};

function sameValue(field: PricingField, next: unknown, current: unknown): boolean {
  if (isEmpty(next) && isEmpty(current)) return true;
  if (isEmpty(next) || isEmpty(current)) return false;
  return COMPARE[field](next, current);
}

/**
 * The pricing fields an update would actually change. A field sent back unchanged (an edit form
 * submitting the whole product) is not a change, so staff can still save the other fields.
 */
export function changedPricingFields(
  current: Partial<Record<PricingField, unknown>>,
  update: Partial<Record<PricingField, unknown>>,
): PricingField[] {
  return PRICING_PRODUCT_FIELDS.filter((field) => update[field] !== undefined && !sameValue(field, update[field], current[field]));
}

/** Whether a variant price update changes the stored price. */
export function variantPriceChanged(currentPrice: unknown, nextPrice: unknown): boolean {
  if (nextPrice === undefined) return false;
  return !sameValue('basePrice', nextPrice, currentPrice);
}
