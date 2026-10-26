import type { Transaction } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { UNAVAILABLE_REASON } from '@core/constants/statuses';
import { ProductVariant } from '@database/models/productVariant.model';

/** The parts of a loaded cart the stock lock reads. */
type LockableCart = {
  items: Array<{
    id: string;
    variantId: string;
    quantity: number;
    variant?: { product?: { name?: string | null } | null } | null;
  }>;
};

/**
 * Row-locks every distinct variant in the cart (SELECT ... FOR UPDATE) and re-checks stock
 * against the locked values. Must run inside the order-creation transaction, after the initial
 * (unlocked) `assertCartItemsAvailable` check and before any stock decrement, so two concurrent
 * checkouts for the same last unit serialize on the lock instead of both reading stale stock.
 */
export async function lockCartVariantsAndAssertStock(cart: LockableCart, transaction: Transaction) {
  const variantIds = [...new Set(cart.items.map((item) => String(item.variantId)))];
  // `ORDER BY id` is required, not cosmetic: without it, Postgres doesn't guarantee the order it
  // acquires locks for a multi-row `WHERE id IN (...) FOR UPDATE`. Two concurrent checkouts
  // sharing overlapping variants, listed in different orders (e.g. cart [X, Y] vs. cart [Y, X]),
  // could then lock them in opposite orders and deadlock. Sorting both transactions' lock
  // acquisition into the same deterministic (ascending id) order rules that out entirely.
  const lockedVariants = await ProductVariant.findAll({
    where: { id: variantIds },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const lockedById = new Map(lockedVariants.map((variant) => [String(variant.id), variant]));
  // Stock is decremented once per line, so check it against the variant's total across
  // lines: two lines of 2 for a variant with 3 left each pass a per-line check.
  const quantityByVariant = new Map<string, number>();
  for (const item of cart.items) {
    const key = String(item.variantId);
    quantityByVariant.set(key, (quantityByVariant.get(key) ?? 0) + Number(item.quantity));
  }

  const unavailable = cart.items
    .map((item) => {
      const locked = lockedById.get(String(item.variantId));
      if (!locked || Number(locked.stock) < (quantityByVariant.get(String(item.variantId)) ?? 0)) {
        return {
          cartItemId: item.id,
          variantId: item.variantId,
          productName: item.variant?.product?.name ?? null,
          unavailableReason: UNAVAILABLE_REASON.OUT_OF_STOCK,
        };
      }
      return null;
    })
    .filter(Boolean);

  if (unavailable.length > 0) {
    throw new AppError(ERROR_MESSAGES.ITEMS_UNAVAILABLE, 422, ERROR_CODES.ITEMS_UNAVAILABLE, {
      items: unavailable,
    });
  }

  return lockedById;
}
