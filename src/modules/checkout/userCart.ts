import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { isRemoved, resolveItemAvailability } from '@core/catalog/customerVisibility';
import { PURCHASABLE_PRODUCT_INCLUDE } from '@core/catalog/purchasableInclude';
import type { Transaction } from 'sequelize';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { markAboveMrp } from '@modules/tax/markAboveMrp';

export type CartWithItems = Cart & {
  items: (CartItem & { variant: ProductVariant & { product: any } })[];
};

/** The customer's cart as checkout reads it, each variant marked against its MRP as of now. */
export async function loadUserCart(userId: string, transaction?: Transaction): Promise<CartWithItems> {
  const cartResult = await Cart.findOne({
    where: { userId },
    include: [
      {
        model: CartItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            // Removed items stay named, and block the checkout with the reason.
            paranoid: false,
            include: [{ association: 'product', paranoid: false, include: PURCHASABLE_PRODUCT_INCLUDE }],
          },
        ],
      },
    ],
    transaction,
  });

  const cart = cartResult as CartWithItems | null;
  if (!cart?.items?.length) throw new ValidationError(ERROR_MESSAGES.CART_EMPTY);
  await markAboveMrp(cart.items.map((item) => item.variant));
  return cart;
}

function availabilityOf(item: CartWithItems['items'][number]) {
  const product = item.variant?.product;
  const vendor = product?.vendor ?? product?.Vendor ?? null;
  return {
    product,
    ...resolveItemAvailability({
      product,
      vendor,
      stock: Number(item.variant?.stock ?? 0),
      quantity: Number(item.quantity),
      aboveMrp: item.variant?.aboveMrp,
      removed: isRemoved(item.variant),
    }),
  };
}

export const isLineSellable = (item: CartWithItems['items'][number]) => availabilityOf(item).isAvailable;

/** Refuses the checkout, naming every line that cannot be bought and why. */
export function assertCartItemsAvailable(cart: CartWithItems): void {
  const unavailable = cart.items.flatMap((item) => {
    const { product, isAvailable, unavailableReason } = availabilityOf(item);
    if (isAvailable) return [];
    return [{
      cartItemId: item.id,
      variantId: item.variantId,
      productName: product?.name ?? null,
      unavailableReason,
      availableQuantity: Math.max(0, Number(item.variant?.stock ?? 0)),
    }];
  });
  if (unavailable.length > 0) {
    throw new AppError(ERROR_MESSAGES.ITEMS_UNAVAILABLE, 422, ERROR_CODES.ITEMS_UNAVAILABLE, { items: unavailable });
  }
}
