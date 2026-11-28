import type { Transaction } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { Product } from '@database/models/product.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductVariant } from '@database/models/productVariant.model';

/**
 * A listing on sale, or waiting to be approved, keeps at least one variant and one image: without
 * them it cannot be bought or shown. Call before removing one, inside the removing transaction;
 * the product row is locked so two removals cannot each take "the other one".
 */
export async function assertNotLastOfListing(
  productId: string,
  kind: 'variant' | 'image',
  transaction: Transaction,
): Promise<void> {
  const product = await Product.findByPk(productId, {
    attributes: ['id', 'status'],
    transaction,
    lock: transaction.LOCK?.UPDATE,
  });
  if (product?.status !== PRODUCT_STATUS.LIVE && product?.status !== PRODUCT_STATUS.PENDING_APPROVAL) return;
  const options = { where: { productId }, transaction };
  const count = kind === 'variant' ? await ProductVariant.count(options) : await ProductImage.count(options);
  if (count > 1) return;
  throw new ValidationError(kind === 'variant' ? ERROR_MESSAGES.PRODUCT_LAST_VARIANT : ERROR_MESSAGES.PRODUCT_LAST_IMAGE);
}

/** The slug a deleted product is left with, so that its name can be used again. */
export const deletedSlug = (product: { id: string; slug: string }) =>
  `${product.slug.slice(0, 220)}--deleted-${product.id.slice(0, 8)}`;
