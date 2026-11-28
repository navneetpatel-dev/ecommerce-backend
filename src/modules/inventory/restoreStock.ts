import type { Transaction } from 'sequelize';
import { ProductVariant } from '@database/models/productVariant.model';
import { notifyBackInStock } from './backInStock';

type VariantRow = { productId: string; stock: number };

const isVariantRow = (value: unknown): value is VariantRow =>
  typeof value === 'object' && value !== null && 'stock' in value && 'productId' in value;

/**
 * Gives units back to a variant (a cancelled, unpaid or returned part). Every path that does so
 * goes through here, so that shoppers waiting for the variant hear when it comes back; they are
 * told only after the transaction commits.
 */
export async function restoreStock(variantId: string, quantity: number, transaction: Transaction): Promise<void> {
  const result = await ProductVariant.increment('stock', { by: quantity, where: { id: variantId }, transaction });
  // The updated row, wherever the dialect nests it.
  const row = ([result] as unknown[]).flat(4).find(isVariantRow);
  if (!row) return;
  const stock = Number(row.stock);
  if (stock > 0 && stock - quantity <= 0) {
    transaction.afterCommit(() => {
      void notifyBackInStock(row.productId, variantId);
    });
  }
}
