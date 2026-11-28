import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ProductVariant } from '@database/models/productVariant.model';

/**
 * The stock a person's edit should write. Orders take and give back stock while an editor is
 * open (an order placed, an unpaid one expiring), so writing the typed number over it would
 * undo them. The edit is the change from what the editor showed (`expected`), applied to the
 * stock as it is now. Locks the variant row first, so concurrent edits and checkouts queue.
 * (Postgres refuses FOR UPDATE across an outer join: lock the variant on its own.)
 */
export async function lockedStockEdit(
  variantId: string,
  requested: number,
  expected: number | undefined,
  transaction: Transaction,
): Promise<{ previous: number; next: number }> {
  const variant = await ProductVariant.findByPk(variantId, {
    attributes: ['id', 'stock'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!variant) throw new NotFoundError('ProductVariant');
  const previous = Number(variant.stock ?? 0);
  const next = expected == null || expected === previous ? requested : Math.max(0, previous + (requested - expected));
  return { previous, next };
}
