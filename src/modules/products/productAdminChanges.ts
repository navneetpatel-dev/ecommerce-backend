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
import { recordVendorLiveEdit } from './vendorLiveEdits';
import type { AddImageRequest, AddVariantRequest, UpdateProductRequest, UpdateVariantRequest } from './products.dto';

/**
 * Edits go through here so that one place decides who may change what and records platform edits:
 * pricing needs the vendor or `product.pricing` (with a written reason), and everything a platform admin
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

  const updated = await productsService.updateProduct(id, actor.vendorId, changes, { actorId: actor.id });
  if (changedFields.length) {
    await recordVendorLiveEdit(actor, before.get({ plain: true }) as typeof before, changedFields, changes);
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
  const variant = await productsService.addVariant(productId, variantFields);
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

  const variant = await productsService.updateVariant(variantId, changes);
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

/**
 * Image changes are content: a platform admin's is told to the vendor, a vendor's on a live listing
 * is told to the admins.
 */
export async function changeImageAs<T>(actor: ProductActor, productId: string, what: string, run: () => Promise<T>) {
  const product = await loadProduct(productId);
  const result = await run();
  await recordVendorLiveEdit(actor, product.get({ plain: true }) as typeof product, [what]);
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

/** A platform edit of stock from the inventory screen. */
export async function recordStockEdit(actor: ProductActor, variantId: string, before: number, after: number) {
  const variant = await ProductVariant.findByPk(variantId, { attributes: ['id', 'sku', 'productId'] });
  if (!variant) return;
  const product = await loadProduct(variant.productId);
  if (before === after) return;
  await record(actor, product, {
    action: 'PRODUCT_STOCK_UPDATED_ON_BEHALF',
    changedFields: ['variant stock'],
    metadata: { sku: variant.sku, before: { stock: before }, after: { stock: after } },
  });
}

export async function deleteVariantAs(actor: ProductActor, variantId: string) {
  const variant = await ProductVariant.findByPk(variantId);
  if (!variant) throw new NotFoundError('ProductVariant');
  const product = await loadProduct(variant.productId);
  await productsService.deleteVariant(variantId);
  await record(actor, product, {
    action: 'PRODUCT_VARIANT_DELETED_ON_BEHALF',
    changedFields: ['variant removed'],
    metadata: { sku: variant.sku, price: Number(variant.price), stock: Number(variant.stock) },
  });
}

export async function deleteProductAs(actor: ProductActor, id: string) {
  const product = await loadProduct(id);
  await productsService.deleteProduct(id, actor.vendorId);
  await record(actor, product, { action: 'PRODUCT_DELETED_ON_BEHALF', changedFields: ['listing deleted'] });
}
