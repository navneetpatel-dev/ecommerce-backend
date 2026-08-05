import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { cartRepository } from './cart.repository';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { sequelize } from '@database/models';
import type { AddToCartRequest, UpdateCartItemRequest } from './cart.dto';

export class CartService {
  async getCart(userId: string | null, sessionId: string | null) {
    let cart;
    if (userId) {
      cart = await cartRepository.findByUserId(userId);
    } else if (sessionId) {
      cart = await cartRepository.findBySessionId(sessionId);
    }

    if (!cart) {
      return { items: [], total: 0 };
    }

    const items = await CartItem.findAll({
      where: { cartId: cart.id },
      include: [{ model: ProductVariant, as: 'variant', include: ['product'] }],
    }) as (CartItem & { variant: ProductVariant & { product: any } })[];

    const total = items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0);

    return { cart, items, total };
  }

  async addToCart(userId: string | null, sessionId: string | null, data: AddToCartRequest) {
    return sequelize.transaction(async (t) => {
      const variant = await ProductVariant.findByPk(data.variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      if (variant.stock < data.quantity) {
        throw new ValidationError('Insufficient stock');
      }

      let cart;
      if (userId) {
        cart = await cartRepository.findOrCreateByUser(userId);
      } else if (sessionId) {
        cart = await cartRepository.findOrCreateBySession(sessionId);
      } else {
        throw new ValidationError('No user or session ID provided');
      }

      const existingItem = await CartItem.findOne({
        where: { cartId: cart.id, variantId: data.variantId },
        transaction: t,
      });

      if (existingItem) {
        const newQuantity = existingItem.quantity + data.quantity;
        if (variant.stock < newQuantity) {
          throw new ValidationError('Insufficient stock');
        }
        await existingItem.update({ quantity: newQuantity }, { transaction: t });
      } else {
        await CartItem.create(
          {
            cartId: cart.id,
            variantId: data.variantId,
            quantity: data.quantity,
          },
          { transaction: t }
        );
      }

      return this.getCart(userId, sessionId);
    });
  }

  async updateCartItem(userId: string | null, sessionId: string | null, itemId: string, data: UpdateCartItemRequest) {
    return sequelize.transaction(async (t) => {
      const itemResult = await CartItem.findByPk(itemId, {
        include: ['variant'],
        transaction: t,
      });

      if (!itemResult) throw new NotFoundError('CartItem');

      const item = itemResult as CartItem & { variant: ProductVariant };

      if (item.variant.stock < data.quantity) {
        throw new ValidationError('Insufficient stock');
      }

      await item.update({ quantity: data.quantity }, { transaction: t });

      return this.getCart(userId, sessionId);
    });
  }

  async removeFromCart(userId: string | null, sessionId: string | null, itemId: string) {
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

  async mergeGuestCartIntoUserCart(sessionId: string, userId: string) {
    return sequelize.transaction(async (t) => {
      const guestCart = await cartRepository.findBySessionId(sessionId);
      if (!guestCart) return;

      const userCart = await cartRepository.findOrCreateByUser(userId);

      const guestItems = await CartItem.findAll({
        where: { cartId: guestCart.id },
        transaction: t,
      });

      for (const guestItem of guestItems) {
        const existing = await CartItem.findOne({
          where: { cartId: userCart.id, variantId: guestItem.variantId },
          transaction: t,
        });

        if (existing) {
          await existing.update(
            { quantity: existing.quantity + guestItem.quantity },
            { transaction: t }
          );
        } else {
          await CartItem.create(
            {
              cartId: userCart.id,
              variantId: guestItem.variantId,
              quantity: guestItem.quantity,
            },
            { transaction: t }
          );
        }
      }

      await guestCart.destroy({ transaction: t });
    });
  }
}

export const cartService = new CartService();
