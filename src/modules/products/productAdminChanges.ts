import { NotFoundError } from '@core/errors/NotFoundError';
import { ProductImage } from '@database/models/productImage.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { productsService } from './products.service';
import { productsRepository } from './products.repository';
import { changedPricingFields, variantPriceChanged } from './productPricingRules';
import { assertPricingChangeAllowed, isOnBehalf, type ProductActor } from './productChangePolicy';
import {
  auditOnBehalf,
  beforeAfter,
  changedFieldNames,
  notifyUpdated,
  type OnBehalfAction,
} from './productChangeAudit';
import type { AddImageRequest, AddVariantRequest, UpdateProductRequest, UpdateVariantRequest } from './products.dto';

/**
 * Edits go through here so that one place decides who may change what and records platform edits:
 * pricing needs the owner or `product.pricing` (with a written reason), and everything a platform admin
 * does to a vendor's product is audited "on behalf" and told to the vendor.
 */
const today = () => new Date().toISOString().slice(0, 10);

async function loadProduct(productId: string) {
  const product = await productsRepository.findById(productId);
  if (!product) throw new NotFoundError('Product');
  return product;
}

type Recorded = {
  action: OnBehalfAction;
  changedFields: string[];
  metadata?: Record<string, unknown>;
  /** A pricing change always notifies; content edits are bundled into one email a day. */
  reason?: string | null;
};

/** Writes the audit row and tells the vendor, only when a platform admin acted on a vendor's product. */
async function record(actor: ProductActor, product: { id: string; name: string; vendorId: string | null; status: string; listedByPlatform?: boolean | null }, entry: Recorded) {
  if (!isOnBehalf(actor, product)) return;
  const audit = await auditOnBehalf({
    actorId: actor.id,
    action: entry.action,
    productId: product.id,
    vendorId: product.vendorId!,
    name: product.name,
    metadata: { ...entry.metadata, changedFields: entry.changedFields, ...(entry.reason && { reason: entry.reason }) },
  });
  const pricing = entry.action === 'PRODUCT_PRICING_CHANGED_ON_BEHALF' || Boolean(entry.reason);
  void notifyUpdated(product.vendorId!, pricing ? audit.id : `${product.id}:${today()}`, {
    productName: product.name,
    changes: entry.changedFields.join(', ') || 'details',
    reason: entry.reason,
  });
}

export async function updateProductAs(actor: ProductActor, id: string, dto: UpdateProductRequest & { changeReason?: string }) {
  const { changeReason, ...changes } = dto;
  const before = await loadProduct(id);
  const pricingFields = changedPricingFields(before, changes);
  const reason = pricingFields.length ? assertPricingChangeAllowed(actor, before, changeReason) : null;
  const snapshot = before.get({ plain: true }) as Record<string, unknown>;
  const changedFields = changedFieldNames(snapshot, changes as Record<string, unknown>);

  const updated = await productsService.updateProduct(id, actor.vendorId, changes, { canEditPricing: true, actorId: actor.id });
  if (changedFields.length) {
    await record(actor, before, {
      action: pricingFields.length ? 'PRODUCT_PRICING_CHANGED_ON_BEHALF' : 'PRODUCT_UPDATED_ON_BEHALF',
      changedFields,
      reason,
      metadata: pricingFields.length ? beforeAfter(snapshot, changes as Record<string, unknown>, pricingFields) : undefined,
    });
  }
  return updated;
}

export async function addVariantAs(actor: ProductActor, productId: string, dto: AddVariantRequest & { changeReason?: string }) {
  const { changeReason, ...variantFields } = dto;
  const product = await loadProduct(productId);
  const reason = assertPricingChangeAllowed(actor, product, changeReason);
  const variant = await productsService.addVariant(productId, variantFields, { canEditPricing: true });
  await record(actor, product, {
    action: 'PRODUCT_VARIANT_ADDED_ON_BEHALF',
    changedFields: ['variant'],
    reason,
    metadata: { sku: variantFields.sku, price: variantFields.price, stock: variantFields.stock ?? null },
  });
  return variant;
}

export async function updateVariantAs(actor: ProductActor, variantId: string, dto: UpdateVariantRequest & { changeReason?: string }) {
  const { changeReason, ...changes } = dto;
  const row = await ProductVariant.findByPk(variantId);
  if (!row) throw new NotFoundError('ProductVariant');
  const product = await loadProduct(row.productId);
  const priceChanged = variantPriceChanged(row.price, changes.price);
  const reason = priceChanged ? assertPricingChangeAllowed(actor, product, changeReason) : null;
  const snapshot = row.get({ plain: true }) as Record<string, unknown>;
  const changedFields = changedFieldNames(snapshot, changes as Record<string, unknown>);

  const variant = await productsService.updateVariant(variantId, changes, { canEditPricing: true });
  if (changedFields.length) {
    await record(actor, product, {
      action: 'PRODUCT_VARIANT_UPDATED_ON_BEHALF',
      changedFields: changedFields.map((field) => `variant ${field}`),
      reason,
      metadata: { sku: row.sku, ...(priceChanged && beforeAfter(snapshot, changes as Record<string, unknown>, ['price'])) },
    });
  }
  return variant;
}

/** Image changes are content: audited and told to the vendor when the platform makes them. */
export async function changeImageAs<T>(actor: ProductActor, productId: string, what: string, run: () => Promise<T>) {
  const product = await loadProduct(productId);
  const result = await run();
  await record(actor, product, { action: 'PRODUCT_IMAGE_CHANGED_ON_BEHALF', changedFields: [what] });
  return result;
}

export async function addImageAs(actor: ProductActor, productId: string, dto: AddImageRequest) {
  return changeImageAs(actor, productId, 'images', () => productsService.addImage(productId, dto));
}

/** The product an image belongs to (for the image routes, which carry only the image id). */
export async function productIdOfImage(imageId: string): Promise<string> {
  const image = await ProductImage.findByPk(imageId, { attributes: ['id', 'productId'] });
  if (!image) throw new NotFoundError('ProductImage');
  return image.productId;
}
