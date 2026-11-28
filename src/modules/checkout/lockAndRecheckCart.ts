import type { Transaction } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { PURCHASABLE_PRODUCT_INCLUDE } from '@core/catalog/purchasableInclude';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { markAboveMrp } from '@modules/tax/markAboveMrp';
import { lockCartVariantsAndAssertStock } from './lockCartStock';

type Cart = Parameters<typeof lockCartVariantsAndAssertStock>[0];

/**
 * The last check before an order is written: lock the stock, then read the products again. A
 * category archived or a listing withdrawn since the cart was read stops the order.
 */
export async function lockAndRecheckCart(cart: Cart, transaction: Transaction): Promise<void> {
  const locked = await lockCartVariantsAndAssertStock(cart, transaction);
  const productIds = [...new Set([...locked.values()].map((variant: ProductVariant) => variant.productId))];
  const products = await Product.findAll({ where: { id: productIds }, include: PURCHASABLE_PRODUCT_INCLUDE, transaction });
  const byId = new Map(products.map((product) => [product.id, product]));
  await markAboveMrp([...locked.values()], (variant) => byId.get((variant as ProductVariant).productId));

  const unavailable = cart.items.flatMap((item) => {
    const variant = locked.get(String(item.variantId))!;
    const product = byId.get(variant.productId) as (Product & { vendor?: { status?: string } }) | undefined;
    const { isAvailable, unavailableReason } = resolveItemAvailability({
      product,
      vendor: product?.vendor,
      stock: Number(variant.stock),
      quantity: Number(item.quantity),
      aboveMrp: variant.aboveMrp,
    });
    if (isAvailable) return [];
    return [{
      cartItemId: item.id,
      variantId: item.variantId,
      productName: product?.name ?? null,
      unavailableReason,
      availableQuantity: Math.max(0, Number(variant.stock)),
    }];
  });
  if (unavailable.length > 0) {
    throw new AppError(ERROR_MESSAGES.ITEMS_UNAVAILABLE, 422, ERROR_CODES.ITEMS_UNAVAILABLE, { items: unavailable });
  }
}
