import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { wishlistRepository } from './wishlist.repository';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { CartItem } from '@database/models/cartItem.model';
import { Cart } from '@database/models/cart.model';
import { sequelize } from '@database/models';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { resolveItemAvailability, isProductCustomerVisible } from '@core/catalog/customerVisibility';
import { productDiscountPercent, productShowMrp } from '@modules/pricing/displayMoney';
import { roundMoney } from '@modules/pricing/money';

function mapWishlistProduct(product: Product | null | undefined) {
  if (!product) return null;
  const plain: any = typeof product.get === 'function' ? product.get({ plain: true }) : product;
  const primaryImage =
    plain.images?.find((img: any) => img.isPrimary)?.url || plain.images?.[0]?.url || '';
  const variants = (plain.variants ?? []).map((variant: any) => ({
    ...variant,
    price: Number(variant.price ?? 0),
    stock: Number(variant.stock ?? 0),
  }));
  const stockFromVariants = variants.reduce((sum: number, variant: { stock: number }) => sum + variant.stock, 0);
  const vendor = plain.vendor ?? plain.Vendor ?? null;
  const stock = Number(plain.stock ?? stockFromVariants);
  const basePrice = roundMoney(plain.basePrice);
  const compareAtPrice = plain.compareAtPrice == null ? null : roundMoney(plain.compareAtPrice);
  const { isAvailable, unavailableReason } = resolveItemAvailability({
    product: plain,
    vendor,
    stock,
    quantity: 1,
  });

  return {
    ...plain,
    variants,
    basePrice,
    compareAtPrice,
    discountPercent: productDiscountPercent(basePrice, compareAtPrice),
    showMrp: productShowMrp(basePrice, compareAtPrice),
    avgRating: Number(plain.avgRating ?? 0),
    stock,
    imageUrl: primaryImage,
    isWishlisted: true,
    vendor: vendor
      ? {
          id: String(vendor.id),
          businessName: vendor.businessName,
          slug: vendor.slug,
          logoUrl: vendor.logoUrl ?? null,
        }
      : null,
    isAvailable,
    unavailableReason,
  };
}

export class WishlistService {
  async getWishlist(userId: string) {
    const wishlist = await wishlistRepository.findByUserId(userId);
    if (!wishlist) {
      return { items: [] };
    }

    // Unscoped product/vendor — report availability instead of silently dropping rows.
    const items = await WishlistItem.findAll({
      where: { wishlistId: wishlist.id },
      include: [{
        model: Product,
        as: 'product',
        include: ['images', 'variants', { model: Vendor, as: 'vendor' }],
      }],
    });

    return {
      items: items.map((item) => {
        const plain = item.get({ plain: true }) as any;
        const product = mapWishlistProduct(plain.product);
        return {
          id: plain.id,
          productId: plain.productId,
          priceAtAdd: Number(plain.priceAtAdd ?? 0),
          isAvailable: product?.isAvailable ?? false,
          unavailableReason: product?.unavailableReason ?? null,
          product,
        };
      }),
    };
  }

  async addToWishlist(userId: string, productId: string) {
    return sequelize.transaction(async (t) => {
      const product = await Product.findByPk(productId, {
        include: [{ model: Vendor, as: 'vendor' }],
        transaction: t,
      });
      if (!product) throw new NotFoundError('Product');
      const vendor = (product as any).vendor;
      if (!isProductCustomerVisible(product, vendor)) {
        throw new NotFoundError('Product');
      }

      const wishlist = await wishlistRepository.findOrCreateByUserId(userId);

      // Include soft-deleted rows — unique (wishlistId, productId) survives soft delete
      const existing = await WishlistItem.findOne({
        where: { wishlistId: wishlist.id, productId },
        paranoid: false,
        transaction: t,
      });

      if (existing && !existing.deletedAt) {
        throw new ValidationError(ERROR_MESSAGES.WISHLIST_ALREADY_HAS_PRODUCT);
      }

      if (existing?.deletedAt) {
        await existing.restore({ transaction: t });
        await existing.update({ priceAtAdd: Number(product.basePrice) }, { transaction: t });
        return existing;
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
        throw new ValidationError(ERROR_MESSAGES.WISHLIST_NO_VARIANTS);
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
