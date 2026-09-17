import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { type UnavailableReason } from '@core/constants/statuses';
import { resolveItemAvailability } from '@core/catalog/customerVisibility';
import { combinedDiscount, lineSubtotal } from '@modules/pricing/displayMoney';
import { roundMoney } from '@modules/pricing/money';
import { computeVendorShippingWeightsByVendor } from '@modules/shipping/shippingWeight';
import { resolveShippingDisplayKey } from '@modules/checkout/checkoutOrderTotals';
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
  /**
   * Server-decided cap for this line (stock vs the cart policy cap).
   * The API silently clamps to it, so the client must not offer more —
   * otherwise the stepper counts past stock and snaps back on the response.
   */
  maxQuantity: number;
  lineSubtotal: number;
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
    shippingDisplayKey: 'FREE' | 'PAID';
    grandTotal: number;
    /**
     * What the preview's tax and shipping were based on. The cart has no chosen
     * address or shipping method, so anything but EXACT is an estimate the FE
     * should label as such — checkout re-quotes against the real selection.
     *
     * NO_SHIPPING_RATE means no rate matched the default address, so shipping is
     * shown as zero here but checkout will reject that address.
     */
    basisKey: 'EXACT' | 'DEFAULT_ADDRESS' | 'NO_SHIPPING_RATE' | 'NO_ADDRESS';
  };
  appliedCoupon?: {
    code: string;
    discount: number;
    cashbackAmount: number;
    type: string;
    vendorDiscountShares?: Record<string, number>;
    vendorShippingDiscountShares?: Record<string, number>;
    vendorBorneDiscountShares?: Record<string, number>;
    payNowGrandTotal?: number;
  } | null;
  appliedCoupons?: Array<{ code: string; discount: number; cashbackAmount: number; type: string }>;
  removedCouponReason?: string | null;
  /** Diagnostic/read-only weights; shipping APIs always recompute them server-side. */
  vendorShippingWeights?: Record<string, number>;
};

function mapCartItem(item: CartItem & { variant?: ProductVariant & { product?: any } }): CartViewItem {
  const variant = item.variant;
  const product = variant?.product;
  const images = product?.images ?? [];
  const primaryImage = images.find((img: any) => img.isPrimary)?.url || images[0]?.url || '';
  const vendor = product?.vendor ?? product?.Vendor ?? null;
  const quantity = Number(item.quantity);
  const price = roundMoney(variant?.price ?? product?.basePrice ?? 0);
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
    maxQuantity: clampQuantity(MAX_CART_LINE_QUANTITY, stock),
    lineSubtotal: lineSubtotal(price, quantity),
    isAvailable,
    unavailableReason,
    product: {
      id: String(product?.id ?? ''),
      name: product?.name ?? 'Unknown product',
      slug: product?.slug ?? '',
      imageUrl: primaryImage,
      price,
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

function cartHasCoupon(cart: Cart): boolean {
  return Boolean(cart.couponCode) || (cart.couponCodes?.length ?? 0) > 0;
}

/** Copy guest coupons onto the user cart only when the user has none selected. */
async function copyGuestCouponIfUserCartEmpty(
  guestCart: Cart,
  userCart: Cart,
  transaction: Transaction,
) {
  if (!cartHasCoupon(guestCart) || cartHasCoupon(userCart)) return;
  await userCart.update(
    { couponCode: guestCart.couponCode, couponCodes: guestCart.couponCodes ?? [] },
    { transaction },
  );
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
    const items = (await CartItem.findAll({
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
    })) as (CartItem & { variant: ProductVariant & { product: any } })[];

    const mappedItems = items.map(mapCartItem);
    const available = mappedItems.filter((item) => item.isAvailable);
    const merchandiseSubtotal = roundMoney(available.reduce((sum, item) => sum + item.lineSubtotal, 0));

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
      vendorShippingDiscountShares = revalidated.appliedCoupon?.vendorShippingDiscountShares ?? {};
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

    if (appliedCoupon && appliedCoupon.cashbackAmount > 0) {
      appliedCoupon = {
        ...appliedCoupon,
        payNowGrandTotal: pricingPreview.grandTotal,
      };
    }

    const vendorShippingWeights = computeVendorShippingWeightsByVendor(
      available.map((item) => ({
        vendorId: item.product.vendor.id,
        quantity: item.quantity,
        variant: item.variant,
      })),
    );

    return {
      id: String(cart.id),
      items: mappedItems,
      merchandiseSubtotal,
      total: pricingPreview.grandTotal,
      pricingPreview,
      vendorShippingWeights,
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
    const merchandiseSubtotal = input.items.reduce((sum, item) => sum + item.lineSubtotal, 0);
    if (input.items.length === 0) {
      return {
        merchandiseSubtotal: 0,
        discount: 0,
        taxTotal: 0,
        shippingTotal: 0,
        shippingDisplayKey: 'FREE',
        grandTotal: 0,
        basisKey: 'NO_ADDRESS',
      };
    }

    const { settingsService } = await import('@modules/settings/settings.service');
    // Dynamic import: checkout imports cart, so a static edge here would close the cycle.
    const { buildVendorPricingRows, priceVendorRows, PLATFORM_VENDOR_ID } = await import('@modules/checkout/vendorPricingPlan');
    const { Address } = await import('@database/models/address.model');

    const settings = await settingsService.getPlatformSettings();

    let shippingAddress: { pincode: string; state: string } | null = null;
    if (input.userId) {
      const address = await Address.findOne({
        where: { userId: input.userId },
        order: [
          ['isDefault', 'DESC'],
          ['updatedAt', 'DESC'],
        ],
      });
      if (address?.pincode) {
        shippingAddress = {
          pincode: String(address.pincode).trim(),
          state: String(address.state ?? '').trim(),
        };
      }
    }

    // categoryId is not on CartViewItem — batch-load it rather than querying per line.
    const productIds = [...new Set(input.items.map((item) => item.product.id).filter(Boolean))];
    const products = productIds.length
      ? await Product.findAll({
          where: { id: productIds },
          attributes: ['id', 'categoryId'],
        })
      : [];
    const categoryByProduct = new Map(products.map((product) => [String(product.id), product.categoryId ?? null]));

    const plan = await buildVendorPricingRows({
      lines: input.items.map((item) => ({
        key: item.id,
        vendorId: item.product.vendor.id || PLATFORM_VENDOR_ID,
        unitPrice: item.product.price,
        quantity: item.quantity,
        categoryId: categoryByProduct.get(item.product.id) ?? null,
        weightGrams: item.variant.weightGrams ?? null,
      })),
      destination: shippingAddress,
      // The cart has no chosen method yet; checkout re-quotes with the real selection.
      shippingMethodByVendor: {},
      settings,
      onMissingRate: 'estimate',
    });

    const { pricedByVendor } = priceVendorRows({
      rows: plan.rows,
      shares: {
        vendorDiscountShares: input.vendorDiscountShares,
        vendorShippingDiscountShares: input.vendorShippingDiscountShares,
        vendorBorneDiscountShares: input.vendorBorneDiscountShares,
      },
      shippingStateCode: shippingAddress?.state ?? '',
      settings,
    });

    let discount = 0;
    let taxTotal = 0;
    let shippingTotal = 0;
    let grandTotal = 0;
    for (const priced of Object.values(pricedByVendor)) {
      const r = priced.rupees;
      discount += combinedDiscount(r.merchandiseDiscount, r.shippingDiscount);
      taxTotal += r.tax.total;
      shippingTotal += r.shippingCharged;
      grandTotal += r.customerTotal;
    }

    if (discount === 0 && input.merchandiseDiscountTotal > 0) {
      discount = input.merchandiseDiscountTotal;
    }

    return {
      merchandiseSubtotal: roundMoney(merchandiseSubtotal),
      discount: roundMoney(discount),
      taxTotal: roundMoney(taxTotal),
      shippingTotal: roundMoney(shippingTotal),
      shippingDisplayKey: resolveShippingDisplayKey(shippingTotal),
      grandTotal: roundMoney(grandTotal),
      // Report the weakest link: a missing rate makes the shipping figure a
      // placeholder, which is less certain than merely guessing the address.
      basisKey: !shippingAddress ? 'NO_ADDRESS' : plan.hasEstimatedShipping ? 'NO_SHIPPING_RATE' : 'DEFAULT_ADDRESS',
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

  async addToCart(userId: string | null, sessionId: string | null, data: AddToCartRequest): Promise<CartView> {
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

  /** Resolves the caller's own cart id — never creates one, since a mutation implies it must already exist. */
  private async resolveOwnCartId(
    userId: string | null,
    sessionId: string | null,
    transaction: Transaction,
  ): Promise<string> {
    let cart;
    if (userId) {
      cart = await cartRepository.findByUserId(userId, transaction);
    } else if (sessionId) {
      cart = await cartRepository.findBySessionId(sessionId, transaction);
    } else {
      throw new ValidationError('No user or session ID provided');
    }
    if (!cart) throw new NotFoundError('CartItem');
    return cart.id;
  }

  async updateCartItem(userId: string | null, sessionId: string | null, itemId: string, data: UpdateCartItemRequest): Promise<CartView> {
    await sequelize.transaction(async (t) => {
      const ownCartId = await this.resolveOwnCartId(userId, sessionId, t);

      // Postgres rejects FOR UPDATE on the nullable side of an OUTER JOIN.
      // Lock the cart line alone, then load the variant without a lock.
      const item = await CartItem.findByPk(itemId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!item || item.cartId !== ownCartId) throw new NotFoundError('CartItem');

      const variant = await ProductVariant.findByPk(item.variantId, { transaction: t });
      if (!variant) throw new NotFoundError('ProductVariant');

      const quantity = clampQuantity(data.quantity, variant.stock);
      if (quantity < 1) {
        throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
      }

      await item.update({ quantity }, { transaction: t });
    });

    return this.getCart(userId, sessionId);
  }

  async removeFromCart(userId: string | null, sessionId: string | null, itemId: string): Promise<CartView> {
    await sequelize.transaction(async (t) => {
      const ownCartId = await this.resolveOwnCartId(userId, sessionId, t);

      const item = await CartItem.findByPk(itemId, { transaction: t });
      if (!item || item.cartId !== ownCartId) throw new NotFoundError('CartItem');

      await item.destroy({ transaction: t });
    });

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

  async mergeGuestCartIntoUserCart(sessionId: string, userId: string): Promise<{ merged: boolean }> {
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
        await copyGuestCouponIfUserCartEmpty(guestCart, userCart, t);
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
      await copyGuestCouponIfUserCartEmpty(guestCart, userCart, t);
      await guestCart.destroy({ transaction: t });
      return { merged: true };
    });
  }

  /**
   * Restores order lines into the user cart (used by payment-cancel paths).
   * Caller must hold an order row lock / claim so this runs at most once per order.
   */
  async restoreItemsToUserCart(userId: string, lines: Array<{ variantId: string; quantity: number }>, transaction: Transaction) {
    if (lines.length === 0) return;

    const cart = await cartRepository.findOrCreateByUser(userId, transaction);

    const qtyByVariant = new Map<string, number>();
    for (const line of lines) {
      qtyByVariant.set(line.variantId, (qtyByVariant.get(line.variantId) ?? 0) + line.quantity);
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
          await CartItem.create({ cartId: cart.id, variantId, quantity }, { transaction });
        }
      }
    }
  }
}

export const cartService = new CartService();
