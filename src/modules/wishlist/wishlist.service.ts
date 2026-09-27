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
import { productDiscountPercent, productShowMrp, wishlistPriceDrop } from '@modules/pricing/displayMoney';
import { roundMoney } from '@modules/pricing/money';
import { MAX_CART_LINE_QUANTITY } from '@modules/cart/cart.constants';
import { gstRuleResolver, priceWithRuleGst } from '@modules/products/products.service';

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
  // The GST-inclusive price customers see; the MRP includes GST, so "% off" uses it.
  const displayPrice = plain.displayPrice != null ? roundMoney(plain.displayPrice) : basePrice;
  const variantPrices = variants.map((variant: { price: number }) => variant.price);
  const priceRangeMax = variantPrices.length ? roundMoney(Math.max(...variantPrices)) : basePrice;
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
    displayPrice,
    compareAtPrice,
    discountPercent: productDiscountPercent(displayPrice, compareAtPrice),
    showMrp: productShowMrp(displayPrice, compareAtPrice),
    priceRangeMax,
    hasPriceRange: priceRangeMax > basePrice,
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

    const ruleFor = gstRuleResolver();
    return {
      items: await Promise.all(items.map(async (item) => {
        const plain = item.get({ plain: true }) as any;
        const product = mapWishlistProduct(plain.product);
        const priceAtAdd = roundMoney(plain.priceAtAdd);
        // The saved price is before GST; the drop is shown in the GST-inclusive prices
        // the customer sees.
        const priceDropAmount = product
          ? wishlistPriceDrop(
              priceWithRuleGst(await ruleFor(product.categoryId), priceAtAdd),
              product.displayPrice,
            )
          : null;
        return {
          id: plain.id,
          productId: plain.productId,
          priceAtAdd,
          priceDropAmount,
          isAvailable: product?.isAvailable ?? false,
          unavailableReason: product?.unavailableReason ?? null,
          product,
        };
      })),
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

      // The wishlist shows (and tracks price drops on) the product's listed price, its
      // lowest variant price: add the cheapest in-stock variant, oldest first on a tie,
      // so the cart holds the price the customer saw. It must actually be in stock.
      const variants = (wishlistItem.product.variants ?? [])
        .slice()
        .sort(
          (a, b) =>
            Number(a.price) - Number(b.price) ||
            new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
        );
      if (variants.length === 0) {
        throw new ValidationError(ERROR_MESSAGES.WISHLIST_NO_VARIANTS);
      }
      const variant = variants.find((v) => Number(v.stock) > 0);
      if (!variant) {
        throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
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
        const nextQuantity = Math.max(
          0,
          Math.min(existingCartItem.quantity + 1, Number(variant.stock), MAX_CART_LINE_QUANTITY),
        );
        if (nextQuantity !== existingCartItem.quantity) {
          await existingCartItem.update({ quantity: nextQuantity }, { transaction: t });
        } else if (Number(variant.stock) <= existingCartItem.quantity) {
          throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
        }
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
