import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { type UnavailableReason } from '@core/constants/statuses';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
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
  isAvailable: boolean;
  unavailableReason: UnavailableReason | null;
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
  /** Merchandise subtotal (available lines). */
  merchandiseSubtotal: number;
  /** Customer-facing total from PricingEngine preview (tax + est. shipping − discount). */
  total: number;
  pricingPreview?: {
    merchandiseSubtotal: number;
    discount: number;
    taxTotal: number;
    shippingTotal: number;
    grandTotal: number;
  };
  appliedCoupon?: { code: string; discount: number; cashbackAmount: number; type: string } | null;
  appliedCoupons?: Array<{ code: string; discount: number; cashbackAmount: number; type: string }>;
  removedCouponReason?: string | null;
};

function mapCartItem(item: CartItem & { variant?: ProductVariant & { product?: any } }): CartViewItem {
  const variant = item.variant;
  const product = variant?.product;
  const images = product?.images ?? [];
  const primaryImage =
    images.find((img: any) => img.isPrimary)?.url || images[0]?.url || '';
  const vendor = product?.vendor ?? product?.Vendor ?? null;
  const quantity = Number(item.quantity);
  const stock = Number(variant?.stock ?? 0);
  const { isAvailable, unavailableReason } = resolveItemAvailability({
    product,
    vendor,
    stock,
    quantity,
  });

  return {
    id: String(item.id),
    variantId: String(item.variantId),
    quantity,
    isAvailable,
    unavailableReason,
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
      return { id: null, items: [], total: 0, merchandiseSubtotal: 0 };
    }

    // Unscoped Product/Vendor include — hidden items stay visible with isAvailable=false.
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
    const available = mappedItems.filter((item) => item.isAvailable);
    const merchandiseSubtotal = available.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0,
    );

    let appliedCoupon: CartView['appliedCoupon'] = null;
    let appliedCoupons: CartView['appliedCoupons'] = [];
    let removedCouponReason: string | null = null;
    let vendorDiscountShares: Record<string, number> = {};
    let vendorShippingDiscountShares: Record<string, number> = {};
    let vendorBorneDiscountShares: Record<string, number> = {};
    if (userId) {
      const { couponsService } = await import('@modules/coupons/coupons.service');
      const revalidated = await couponsService.revalidateCartCoupon(userId);
      appliedCoupon = revalidated.appliedCoupon;
      appliedCoupons = revalidated.appliedCoupons;
      removedCouponReason = revalidated.removed ? revalidated.reason : null;
      vendorDiscountShares = revalidated.appliedCoupon?.vendorDiscountShares ?? {};
      vendorShippingDiscountShares =
        revalidated.appliedCoupon?.vendorShippingDiscountShares ?? {};
      vendorBorneDiscountShares = revalidated.appliedCoupon?.vendorBorneDiscountShares ?? {};
    }

    const pricingPreview = await this.buildPricingPreview({
      userId,
      items: available,
      vendorDiscountShares,
      vendorShippingDiscountShares,
      vendorBorneDiscountShares,
      merchandiseDiscountTotal: appliedCoupon?.discount ?? 0,
    });

    return {
      id: String(cart.id),
      items: mappedItems,
      merchandiseSubtotal,
      total: pricingPreview.grandTotal,
      pricingPreview,
      appliedCoupon,
      appliedCoupons,
      removedCouponReason,
    };
  }

  private async buildPricingPreview(input: {
    userId: string | null;
    items: CartViewItem[];
    vendorDiscountShares: Record<string, number>;
    vendorShippingDiscountShares: Record<string, number>;
    vendorBorneDiscountShares: Record<string, number>;
    merchandiseDiscountTotal: number;
  }): Promise<NonNullable<CartView['pricingPreview']>> {
    const merchandiseSubtotal = input.items.reduce(
      (sum, item) => sum + item.product.price * item.quantity,
      0,
    );
    if (input.items.length === 0) {
      return {
        merchandiseSubtotal: 0,
        discount: 0,
        taxTotal: 0,
        shippingTotal: 0,
        grandTotal: 0,
      };
    }

    const { settingsService } = await import('@modules/settings/settings.service');
    const { taxService } = await import('@modules/tax/tax.service');
    const { categoriesService } = await import('@modules/categories/categories.service');
    const { pricingService } = await import('@modules/pricing/pricing.service');
    const { resolveVendorDiscountBearer } = await import('@modules/coupons/couponEngine');
    const { ShippingRate } = await import('@database/models/shippingRate.model');
    const { Address } = await import('@database/models/address.model');

    const settings = await settingsService.getPlatformSettings();
    const cheapest = await ShippingRate.findOne({ order: [['price', 'ASC']] });
    const estShippingPerVendor = Number(cheapest?.price ?? 0);

    let shippingStateCode = '';
    if (input.userId) {
      const address = await Address.findOne({
        where: { userId: input.userId },
        order: [
          ['isDefault', 'DESC'],
          ['updatedAt', 'DESC'],
        ],
      });
      shippingStateCode = String(address?.state ?? '').trim();
    }

    const byVendor = new Map<string, CartViewItem[]>();
    for (const item of input.items) {
      const vendorId = item.product.vendor.id || 'platform';
      const list = byVendor.get(vendorId) ?? [];
      list.push(item);
      byVendor.set(vendorId, list);
    }

    let discount = 0;
    let taxTotal = 0;
    let shippingTotal = 0;
    let grandTotal = 0;

    for (const [vendorId, vendorItems] of byVendor) {
      const vendor = vendorId !== 'platform' ? await Vendor.findByPk(vendorId) : null;
      const lineMeta: Array<{
        key: string;
        unitPrice: number;
        quantity: number;
        gstPercentage: number;
        commissionRatePercent: number;
      }> = [];
      for (const item of vendorItems) {
        const product = await Product.findByPk(item.product.id, {
          attributes: ['categoryId', 'vendorId'],
        });
        const categoryId = product?.categoryId ?? null;
        const gstPercentage = categoryId ? await taxService.getGstRate(categoryId) : 0;
        const commissionRatePercent = categoryId
          ? await categoriesService.resolveCommissionRate(
              categoryId,
              vendor?.commissionRate,
              settings.defaultCommissionRate,
            )
          : settings.defaultCommissionRate;
        lineMeta.push({
          key: item.id,
          unitPrice: item.product.price,
          quantity: item.quantity,
          gstPercentage,
          commissionRatePercent,
        });
      }
      const fallback = lineMeta[0];
      const merchandiseDiscount = input.vendorDiscountShares[vendorId] ?? 0;
      const shippingDiscount = Math.min(
        estShippingPerVendor,
        input.vendorShippingDiscountShares[vendorId] ?? 0,
      );
      const vendorBorne = input.vendorBorneDiscountShares[vendorId] ?? 0;
      discount += merchandiseDiscount + shippingDiscount;
      const priced = pricingService.computeVendorBreakdown({
        lines: lineMeta,
        merchandiseDiscount,
        vendorBorneMerchandiseDiscount: vendorBorne,
        shippingDiscount,
        shippingCost: estShippingPerVendor,
        gstPercentage: fallback?.gstPercentage ?? 0,
        vendorStateCode: String(vendor?.state ?? ''),
        shippingStateCode: shippingStateCode || String(vendor?.state ?? ''),
        commissionRatePercent: fallback?.commissionRatePercent ?? settings.defaultCommissionRate,
        discountBearer: resolveVendorDiscountBearer(vendorBorne, merchandiseDiscount),
        tcsRatePercent: settings.tcsRatePercent,
      });
      taxTotal += priced.rupees.tax.total;
      shippingTotal += priced.rupees.shippingCharged;
      grandTotal += priced.rupees.customerTotal;
    }

    if (discount === 0 && input.merchandiseDiscountTotal > 0) {
      discount = input.merchandiseDiscountTotal;
    }

    return {
      merchandiseSubtotal,
      discount,
      taxTotal,
      shippingTotal,
      grandTotal,
    };
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
      const variant = await ProductVariant.findByPk(data.variantId, {
        include: [{ model: Product, as: 'product', include: [{ model: Vendor, as: 'vendor' }] }],
        transaction: t,
      });
      if (!variant) throw new NotFoundError('ProductVariant');

      const product = (variant as any).product;
      const vendor = product?.vendor ?? product?.Vendor ?? null;
      const availability = resolveItemAvailability({
        product,
        vendor,
        stock: Number(variant.stock),
        quantity: data.quantity,
      });
      if (!availability.isAvailable) {
        throw new NotFoundError('Product');
      }

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
