import type { Transaction } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { UNAVAILABLE_REASON } from '@core/constants/statuses';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { PURCHASABLE_PRODUCT_INCLUDE } from '@core/catalog/purchasableInclude';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { markAboveMrp } from '@modules/tax/markAboveMrp';
import { assertStockFor } from './cartStock';

/** The variant being added, once it may be bought in that quantity. */
export async function loadAddableVariant(variantId: string, quantity: number, transaction: Transaction) {
  const variant = await ProductVariant.findByPk(variantId, {
    include: [{ model: Product, as: 'product', include: PURCHASABLE_PRODUCT_INCLUDE }],
    transaction,
  });
  if (!variant) throw new NotFoundError('ProductVariant');

  const product = (variant as any).product;
  const vendor = product?.vendor ?? product?.Vendor ?? null;
  await markAboveMrp([variant], () => product);
  const stock = Number(variant.stock);
  const { unavailableReason } = resolveItemAvailability({
    product, vendor, stock: Math.max(stock, 1), quantity: 1, aboveMrp: variant.aboveMrp,
  });
  // A hidden product reads as missing; an over-MRP option and stock get their own answers.
  if (unavailableReason === UNAVAILABLE_REASON.PRICE_ABOVE_MRP) {
    throw new AppError(ERROR_MESSAGES.ITEM_ABOVE_MRP, 409, ERROR_CODES.ITEM_ABOVE_MRP);
  }
  if (unavailableReason) throw new NotFoundError('Product');
  assertStockFor(quantity, stock);
  return variant;
}
