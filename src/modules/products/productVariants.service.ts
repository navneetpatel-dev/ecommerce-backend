import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { sequelize } from '@database/models';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { inventoryService } from '@modules/inventory/inventory.service';
import { lockedStockEdit } from '@modules/inventory/applyStockEdit';
import { productsRepository } from './products.repository';
import { assertMrpCoversGstPrices, syncProductBasePrice } from './productPricingState';
import { assertNotLastOfListing } from './listingRules';
import { canonicalAttributeKeys } from '@modules/categories/attributeKeys';
import type { AddVariantRequest, UpdateVariantRequest } from './products.dto';

/** Adding, changing and removing a product's variants (`productsService` exposes these). */

export async function addVariant(productId: string, data: AddVariantRequest) {
  return sequelize.transaction(async (t) => {
    const product = await productsRepository.findById(productId, { transaction: t });
    if (!product) throw new NotFoundError('Product');

    const existing = await ProductVariant.findOne({
      where: { sku: data.sku },
      include: [{ model: Product, as: 'product', attributes: ['id', 'deletedAt'], paranoid: false }],
    });
    if (existing) {
      // A deleted product's variants keep their SKUs (order history names them).
      const ofDeleted = (existing as ProductVariant & { product?: Product }).product?.deletedAt;
      throw new ValidationError(ofDeleted ? ERROR_MESSAGES.PRODUCT_SKU_ON_DELETED : ERROR_MESSAGES.PRODUCT_SKU_EXISTS);
    }

    // A piece may not sell above the product's MRP (which includes GST).
    await assertMrpCoversGstPrices(
      product.categoryId,
      [data.price],
      product.compareAtPrice == null ? null : Number(product.compareAtPrice),
      ERROR_MESSAGES.PRODUCT_VARIANT_ABOVE_MRP,
    );

    const variant = await ProductVariant.create({
      productId,
      ...data,
      attributes: await canonicalAttributeKeys(product.categoryId, data.attributes ?? {}, t),
    }, { transaction: t });
    await syncProductBasePrice(productId, t);

    return variant;
  });
}

export async function updateVariant(variantId: string, data: UpdateVariantRequest) {
  let shouldNotifyRestock = false;
  let notifyProductId = '';
  const variant = await sequelize.transaction(async (t) => {
    const { expectedStock, ...fields } = data;
    // A stock change is applied to the stock as it is now, under a row lock (taken before the read).
    const edit = fields.stock !== undefined && expectedStock !== undefined
      ? await lockedStockEdit(variantId, fields.stock, expectedStock, t)
      : null;
    if (edit) fields.stock = edit.next;
    const row = await ProductVariant.findByPk(variantId, { transaction: t });
    if (!row) throw new NotFoundError('ProductVariant');

    const previousStock = edit?.previous ?? Number(row.stock ?? 0);

    if (data.price !== undefined) {
      const product = await Product.findByPk(row.productId, {
        attributes: ['id', 'categoryId', 'compareAtPrice'],
        transaction: t,
      });
      await assertMrpCoversGstPrices(
        product?.categoryId ?? null,
        [data.price],
        product?.compareAtPrice == null ? null : Number(product.compareAtPrice),
        ERROR_MESSAGES.PRODUCT_VARIANT_ABOVE_MRP,
      );
    }

    if (fields.attributes) {
      const owner = await Product.findByPk(row.productId, { attributes: ['categoryId'], transaction: t });
      if (owner) fields.attributes = await canonicalAttributeKeys(owner.categoryId, fields.attributes, t);
    }
    await row.update(fields, { transaction: t });
    if (data.price !== undefined) await syncProductBasePrice(row.productId, t);

    if (fields.stock !== undefined && previousStock <= 0 && fields.stock > 0) {
      shouldNotifyRestock = true;
      notifyProductId = row.productId;
    }

    return row;
  });

  if (shouldNotifyRestock && notifyProductId) {
    void inventoryService.notifyBackInStock(notifyProductId, variantId);
  }

  return variant;
}

export async function deleteVariant(variantId: string) {
  return sequelize.transaction(async (t) => {
    const variant = await ProductVariant.findByPk(variantId, { transaction: t });
    if (!variant) throw new NotFoundError('ProductVariant');

    await assertNotLastOfListing(variant.productId, 'variant', t);
    // Soft delete: order history still names the variant.
    await variant.destroy({ transaction: t });
    await syncProductBasePrice(variant.productId, t);
  });
}
