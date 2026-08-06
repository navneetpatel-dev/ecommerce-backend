import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { cartRepository } from './cart.repository';
import { CartItem } from '@database/models/cartItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import type { AddToCartRequest, UpdateCartItemRequest } from './cart.dto';

function mapCartItem(item: CartItem & { variant?: ProductVariant & { product?: any } }) {
  const variant = item.variant;
  const product = variant?.product;
  const images = product?.images ?? [];
  const primaryImage =
    images.find((img: any) => img.isPrimary)?.url || images[0]?.url || '';
  const vendor = product?.vendor ?? product?.Vendor ?? null;

  return {
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    product: {
      id: product?.id ?? '',
      name: product?.name ?? 'Unknown product',
      slug: product?.slug ?? '',
      imageUrl: primaryImage,
      price: Number(variant?.price ?? product?.basePrice ?? 0),
      vendor: vendor
        ? {
            id: vendor.id,
            businessName: vendor.businessName,
            slug: vendor.slug,
            logoUrl: vendor.logoUrl ?? null,
          }
        : {
            id: product?.vendorId ?? 'unknown',
            businessName: 'Marketplace',
            slug: 'marketplace',
            logoUrl: null,
          },
    },
    variant: {
      sku: variant?.sku ?? '',
      attributes: variant?.attributes ?? {},
    },
  };
}

export class CartService {
  async getCart(userId: string | null, sessionId: string | null) {
    // Logged-in requests still carry a guest session cookie — merge once so the
    // badge doesn't flip between guest and user carts across auth/token changes.
    if (userId && sessionId) {
      await this.mergeGuestCartIntoUserCart(sessionId, userId);
    }

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

    return { id: cart.id, items: mappedItems, total };
  }

  async addToCart(userId: string | null, sessionId: string | null, data: AddToCartRequest) {
    if (userId && sessionId) {
      await this.mergeGuestCartIntoUserCart(sessionId, userId);
    }

    await sequelize.transaction(async (t) => {
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
    });

    return this.getCart(userId, sessionId);
  }

  async updateCartItem(userId: string | null, sessionId: string | null, itemId: string, data: UpdateCartItemRequest) {
    await sequelize.transaction(async (t) => {
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
    });

    return this.getCart(userId, sessionId);
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
