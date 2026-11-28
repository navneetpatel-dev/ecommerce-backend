import type { ProductVariant } from '@database/models/productVariant.model';
import { gstRuleResolver, isAboveMrp } from './gstPricing';

type Priced = { categoryId?: string | null; compareAtPrice?: unknown };
type Marked = Pick<ProductVariant, 'price' | 'aboveMrp'> & { product?: Priced | null };

/**
 * Sets each loaded variant's `aboveMrp` from the tax rule as it is now. The stored flag follows a
 * rule change a few seconds later, and nothing may be sold above its MRP meanwhile. `productOf`
 * supplies the product when it was not loaded on the variant. Nothing is saved.
 */
export async function markAboveMrp(
  variants: Array<Marked | null | undefined>,
  productOf: (variant: Marked) => Priced | null | undefined = (variant) => variant.product,
): Promise<void> {
  const ruleFor = gstRuleResolver();
  for (const variant of variants) {
    const product = variant && productOf(variant);
    if (!variant || !product) continue;
    variant.aboveMrp =
      product.compareAtPrice != null && isAboveMrp(await ruleFor(product.categoryId), variant.price, product.compareAtPrice);
  }
}

/** The product's own flag as of now: true when every price it sells at is above its MRP. */
export async function markProductAboveMrp(
  product: (Priced & { basePrice?: unknown; aboveMrp?: boolean; variants?: Marked[] }) | null | undefined,
): Promise<void> {
  if (!product) return;
  const sold: Marked[] = product.variants?.length ? product.variants : [{ price: Number(product.basePrice), aboveMrp: false }];
  await markAboveMrp(sold, () => product);
  product.aboveMrp = sold.every((variant) => variant.aboveMrp);
}
