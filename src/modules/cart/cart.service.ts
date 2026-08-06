import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { cartRepository } from './cart.repository';
import { MAX_CART_LINE_QUANTITY } from './cart.constants';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import type { AddToCartRequest, UpdateCartItemRequest } from './cart.dto';

export type CartViewItem = {
  id: string;
  variantId: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    price: number;
    vendor: {
      id: string;
      businessName: string;
      slug: string;
      logoUrl: string | null;
    };
  };
  variant: {
    sku: string;
    attributes: Record<string, string>;
    weightGrams: number;
  };
};

export type CartView = {
  id: string | null;
  items: CartViewItem[];
  total: number;
};

function mapCartItem(item: CartItem & { variant?: ProductVariant & { product?: any } }): CartViewItem {
  const variant = item.variant;
  const product = variant?.product;
  const images = product?.images ?? [];
  const primaryImage =
    images.find((img: any) => img.isPrimary)?.url || images[0]?.url || '';
  const vendor = product?.vendor ?? product?.Vendor ?? null;

  return {
    id: String(item.id),
    variantId: String(item.variantId),
    quantity: Number(item.quantity),
    product: {
      id: String(product?.id ?? ''),
      name: product?.name ?? 'Unknown product',
      slug: product?.slug ?? '',
      imageUrl: primaryImage,
      price: Number(variant?.price ?? product?.basePrice ?? 0),
      vendor: vendor
        ? {
            id: String(vendor.id),
            businessName: vendor.businessName,
            slug: vendor.slug,
            logoUrl: vendor.logoUrl ?? null,
          }
        : {
            id: String(product?.vendorId ?? 'unknown'),
            businessName: 'Marketplace',
            slug: 'marketplace',
            logoUrl: null,
          },
    },
    variant: {
      sku: variant?.sku ?? '',
      attributes: (variant?.attributes ?? {}) as Record<string, string>,
      weightGrams: Number(variant?.weightGrams ?? 500),
    },
  };
}

function clampQuantity(desired: number, stock: number) {
  return Math.max(0, Math.min(desired, stock, MAX_CART_LINE_QUANTITY));
}

export class CartService {
  async getCart(userId: string | null, sessionId: string | null): Promise<CartView> {
    let cart;
    if (userId) {
      cart = await cartRepository.findByUserId(userId);
    } else if (sessionId) {
      cart = await cartRepository.findBySessionId(sessionId);
    }

    if (!cart) {
      return { id: null, items: [], total: 0 };
    }

    const items = await CartItem.findAll({
      where: { cartId: cart.id },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      include: [
        {
          model: ProductVariant,
          as: 'variant',
          include: [
            {
              model: Product,
              as: 'product',
              include: ['images', { model: Vendor, as: 'vendor' }],
            },
          ],
        },
      ],
    }) as (CartItem & { variant: ProductVariant & { product: any } })[];

    const mappedItems = items.map(mapCartItem);
    const total = mappedItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

    return { id: String(cart.id), items: mappedItems, total };
  }

  /**
   * Cheap path: indexed lookup by sessionId. No transaction unless a guest cart exists.
   * Safe to call on every authenticated cart request while a leftover guest cookie remains.
   */
  async mergeGuestCartIfPresent(sessionId: string, userId: string): Promise<{ merged: boolean }> {
    const guestExists = await Cart.findOne({
      where: { sessionId },
      attributes: ['id'],
    });
    if (!guestExists) return { merged: false };
    return this.mergeGuestCartIntoUserCart(sessionId, userId);
  }

  async addToCart(
    userId: string | null,
    sessionId: string | null,
    data: AddToCartRequest,
  ): Promise<CartView> {
    await sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(data.variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      const quantity = clampQuantity(data.quantity, variant.stock);
      if (quantity < 1) {
        throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
      }

      let cart;
      if (userId) {
        cart = await cartRepository.findOrCreateByUser(userId, t);
      } else if (sessionId) {
        cart = await cartRepository.findOrCreateBySession(sessionId, t);
      } else {
        throw new ValidationError('No user or session ID provided');
      }

      const existingItem = await CartItem.findOne({
        where: { cartId: cart.id, variantId: data.variantId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existingItem) {
        const newQuantity = clampQuantity(existingItem.quantity + quantity, variant.stock);
        if (newQuantity < 1) {
          throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
        }
        await existingItem.update({ quantity: newQuantity }, { transaction: t });
      } else {
        await CartItem.create(
          {
            cartId: cart.id,
            variantId: data.variantId,
            quantity,
          },
          { transaction: t },
        );
      }
    });

    return this.getCart(userId, sessionId);
  }

  async updateCartItem(
    userId: string | null,
    sessionId: string | null,
    itemId: string,
    data: UpdateCartItemRequest,
  ): Promise<CartView> {
    await sequelize.transaction(async (t) => {
      const itemResult = await CartItem.findByPk(itemId, {
        include: ['variant'],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!itemResult) throw new NotFoundError('CartItem');

      const item = itemResult as CartItem & { variant: ProductVariant };
      const quantity = clampQuantity(data.quantity, item.variant.stock);
      if (quantity < 1) {
        throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
      }

      await item.update({ quantity }, { transaction: t });
    });

    return this.getCart(userId, sessionId);
  }

  async removeFromCart(
    userId: string | null,
    sessionId: string | null,
    itemId: string,
  ): Promise<CartView> {
    const item = await CartItem.findByPk(itemId);
    if (!item) throw new NotFoundError('CartItem');

    await item.destroy();

    return this.getCart(userId, sessionId);
  }

  async clearCart(userId: string | null, sessionId: string | null) {
    let cart;
    if (userId) {
      cart = await cartRepository.findByUserId(userId);
    } else if (sessionId) {
      cart = await cartRepository.findBySessionId(sessionId);
    }

    if (!cart) return;

    await CartItem.destroy({ where: { cartId: cart.id } });
  }

  async mergeGuestCartIntoUserCart(
    sessionId: string,
    userId: string,
  ): Promise<{ merged: boolean }> {
    return sequelize.transaction(async (t) => {
      const guestCart = await Cart.findOne({
        where: { sessionId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!guestCart) return { merged: false };

      // Same browser already bound to this user — nothing to merge.
      if (guestCart.userId === userId) {
        return { merged: false };
      }

      const userCart = await cartRepository.findOrCreateByUser(userId, t);
      if (guestCart.id === userCart.id) {
        return { merged: false };
      }

      const guestItems = await CartItem.findAll({
        where: { cartId: guestCart.id },
        transaction: t,
      });

      if (guestItems.length === 0) {
        await guestCart.destroy({ transaction: t });
        return { merged: false };
      }

      const variantIds = [...new Set(guestItems.map((item) => item.variantId))];
      const variants = await ProductVariant.findAll({
        where: { id: variantIds },
        attributes: ['id', 'stock'],
        transaction: t,
      });
      const stockByVariant = new Map(variants.map((v) => [v.id, v.stock]));

      const userItems = await CartItem.findAll({
        where: { cartId: userCart.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const existingByVariant = new Map(userItems.map((item) => [item.variantId, item]));

      for (const guestItem of guestItems) {
        const stock = stockByVariant.get(guestItem.variantId) ?? 0;
        const existing = existingByVariant.get(guestItem.variantId);

        if (existing) {
          const next = clampQuantity(existing.quantity + guestItem.quantity, stock);
          if (next !== existing.quantity) {
            await existing.update({ quantity: next }, { transaction: t });
          }
        } else {
          const quantity = clampQuantity(guestItem.quantity, stock);
          if (quantity > 0) {
            const created = await CartItem.create(
              {
                cartId: userCart.id,
                variantId: guestItem.variantId,
                quantity,
              },
              { transaction: t },
            );
            existingByVariant.set(guestItem.variantId, created);
          }
        }
      }

      await CartItem.destroy({ where: { cartId: guestCart.id }, transaction: t });
      await guestCart.destroy({ transaction: t });
      return { merged: true };
    });
  }

  /**
   * Restores order lines into the user cart (used by payment-cancel paths).
   * Caller must hold an order row lock / claim so this runs at most once per order.
   */
  async restoreItemsToUserCart(
    userId: string,
    lines: Array<{ variantId: string; quantity: number }>,
    transaction: Transaction,
  ) {
    if (lines.length === 0) return;

    const cart = await cartRepository.findOrCreateByUser(userId, transaction);

    const qtyByVariant = new Map<string, number>();
    for (const line of lines) {
      qtyByVariant.set(
        line.variantId,
        (qtyByVariant.get(line.variantId) ?? 0) + line.quantity,
      );
    }

    const variantIds = [...qtyByVariant.keys()];
    const variants = await ProductVariant.findAll({
      where: { id: variantIds },
      attributes: ['id', 'stock'],
      transaction,
    });
    const stockByVariant = new Map(variants.map((v) => [v.id, v.stock]));

    const existingItems = await CartItem.findAll({
      where: { cartId: cart.id, variantId: variantIds },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const existingByVariant = new Map(existingItems.map((item) => [item.variantId, item]));

    for (const [variantId, restoreQty] of qtyByVariant) {
      const stock = stockByVariant.get(variantId) ?? MAX_CART_LINE_QUANTITY;
      const existing = existingByVariant.get(variantId);

      if (existing) {
        const next = clampQuantity(existing.quantity + restoreQty, stock);
        await existing.update({ quantity: next }, { transaction });
      } else {
        const quantity = clampQuantity(restoreQty, stock);
        if (quantity > 0) {
          await CartItem.create(
            { cartId: cart.id, variantId, quantity },
            { transaction },
          );
        }
      }
    }
  }
}

export const cartService = new CartService();
