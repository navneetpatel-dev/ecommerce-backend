import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { wishlistRepository } from './wishlist.repository';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { Product } from '@database/models/product.model';
import { CartItem } from '@database/models/cartItem.model';
import { Cart } from '@database/models/cart.model';
import { sequelize } from '@database/models';

export class WishlistService {
  async getWishlist(userId: string) {
    const wishlist = await wishlistRepository.findByUserId(userId);
    if (!wishlist) {
      return { items: [] };
    }

    const items = await WishlistItem.findAll({
      where: { wishlistId: wishlist.id },
      include: [{
        model: Product,
        as: 'product',
        include: ['images', 'variants'],
      }],
    });

    return { wishlist, items };
  }

  async addToWishlist(userId: string, productId: string) {
    return sequelize.transaction(async (t) => {
      const product = await Product.findByPk(productId, { transaction: t });
      if (!product) throw new NotFoundError('Product');

      const wishlist = await wishlistRepository.findOrCreateByUserId(userId);

      // Check if already in wishlist
      const existing = await WishlistItem.findOne({
        where: { wishlistId: wishlist.id, productId },
        transaction: t,
      });

      if (existing) {
        throw new ValidationError('Product already in wishlist');
      }

      const item = await WishlistItem.create({
        wishlistId: wishlist.id,
        productId,
        priceAtAdd: Number(product.basePrice),
      }, { transaction: t });

      return item;
    });
  }

  async removeFromWishlist(userId: string, productId: string) {
    return sequelize.transaction(async (t) => {
      const wishlist = await wishlistRepository.findByUserId(userId);
      if (!wishlist) throw new NotFoundError('Wishlist');

      const item = await WishlistItem.findOne({
        where: { wishlistId: wishlist.id, productId },
        transaction: t,
      });

      if (!item) throw new NotFoundError('Wishlist item');

      await item.destroy({ transaction: t });
    });
  }

  async moveToCart(userId: string, productId: string) {
    return sequelize.transaction(async (t) => {
      const wishlist = await wishlistRepository.findByUserId(userId);
      if (!wishlist) throw new NotFoundError('Wishlist');

      const wishlistItemResult = await WishlistItem.findOne({
        where: { wishlistId: wishlist.id, productId },
        include: [{
          model: Product,
          as: 'product',
          include: ['variants'],
        }],
        transaction: t,
      });

      if (!wishlistItemResult) throw new NotFoundError('Wishlist item');

      const wishlistItem = wishlistItemResult as WishlistItem & { product: Product & { variants: any[] } };

      // Get default variant
      const variant = wishlistItem.product.variants?.[0];
      if (!variant) {
        throw new ValidationError('Product has no variants');
      }

      // Add to cart
      const [cart] = await Cart.findOrCreate({
        where: { userId },
        defaults: { userId },
        transaction: t,
      });

      const existingCartItem = await CartItem.findOne({
        where: { cartId: cart.id, variantId: variant.id },
        transaction: t,
      });

      if (existingCartItem) {
        // already exists, increment quantity
        await existingCartItem.increment('quantity', { transaction: t });
      } else {
        // Create new cart item
        await CartItem.create({
          cartId: cart.id,
          variantId: variant.id,
          quantity: 1,
        }, { transaction: t });
      }

      // Remove from wishlist
      await wishlistItem.destroy({ transaction: t });

      return existingCartItem ?? await CartItem.findOne({
        where: { cartId: cart.id, variantId: variant.id },
        transaction: t,
      });
    });
  }
}

export const wishlistService = new WishlistService();
