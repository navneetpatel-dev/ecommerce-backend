import { Address } from '@database/models/address.model';
import { Cart } from '@database/models/cart.model';
import { CartItem } from '@database/models/cartItem.model';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Vendor } from '@database/models/vendor.model';
import { resolveItemAvailability, isProductCustomerVisible } from '@core/catalog/customerVisibility';
import { PURCHASABLE_PRODUCT_INCLUDE } from '@core/catalog/purchasableInclude';
import { markAboveMrp } from '@modules/tax/markAboveMrp';
import type { CartLineForCoupon } from './couponEngine';
import type { CartItemWithProduct } from '@core/catalog/productRelations';

/** The lines a coupon is judged against: the customer's cart, or one product on its page. */

/** The state of the customer's default address ('' without one), as the cart preview bills to. */
async function defaultShippingState(userId: string | null): Promise<string> {
  if (!userId) return '';
  const address = await Address.findOne({
    where: { userId },
    order: [
      ['isDefault', 'DESC'],
      ['updatedAt', 'DESC'],
    ],
    attributes: ['state'],
  });
  return String(address?.state ?? '').trim();
}

/** Coupon lines at GST-inclusive prices (checkout imports coupons: loaded lazily). */
async function gstInclusiveCouponLines(
  lines: CartLineForCoupon[],
  shippingStateCode: string,
): Promise<CartLineForCoupon[]> {
  const { withGstInclusiveLineValues } = await import('@modules/checkout/gstInclusiveLines');
  return withGstInclusiveLineValues(lines, shippingStateCode);
}

export async function loadCartLines(userId: string): Promise<{
  cart: Cart | null;
  lines: CartLineForCoupon[];
  /** A cart line left out as unavailable (out of stock, unpublished) — maybe for now. */
  hasUnavailable: boolean;
}> {
  const cart = await Cart.findOne({
    where: { userId },
    include: [
      {
        model: CartItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            include: [
              {
                model: Product,
                as: 'product',
                include: PURCHASABLE_PRODUCT_INCLUDE,
              },
            ],
          },
        ],
      },
    ],
  });

  const cartItems = (cart as (Cart & { items?: CartItemWithProduct[] }) | null)?.items ?? [];
  await markAboveMrp(cartItems.map((item) => item.variant));
  const availabilityOf = (item: CartItemWithProduct) => {
    const product = item.variant?.product;
    return resolveItemAvailability({
      product,
      vendor: product?.vendor ?? product?.Vendor ?? null,
      stock: Number(item.variant?.stock ?? 0),
      quantity: Number(item.quantity ?? 0),
      aboveMrp: item.variant?.aboveMrp,
    });
  };
  const items = cartItems.filter((item) => availabilityOf(item).isAvailable);

  const lines: CartLineForCoupon[] = items.map((item) => {
    const product = item.variant?.product;
    return {
      productId: String(product?.id ?? ''),
      variantId: String(item.variant?.id ?? item.variantId ?? ''),
      categoryId: product?.categoryId ? String(product.categoryId) : null,
      vendorId: product?.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant?.price ?? 0),
      quantity: Number(item.quantity ?? 0),
      weightGrams: Number(item.variant?.weightGrams ?? 500),
      isCustomerVisible: true,
    };
  });

  // Coupons are set against the prices the customer sees, GST included, valued as the
  // cart bills them (to the customer's default address, as the cart preview is).
  return {
    cart,
    lines: await gstInclusiveCouponLines(lines, await defaultShippingState(userId)),
    hasUnavailable: items.length < cartItems.length,
  };
}

/** Single-product lines for PDP eligible-offer preview (qty 1, primary variant price). */
export async function loadProductPreviewLines(
  productId: string,
  userId: string | null,
  variantId?: string,
): Promise<CartLineForCoupon[]> {
  const product = await Product.findByPk(productId, {
    include: [
      ...PURCHASABLE_PRODUCT_INCLUDE,
      { model: ProductVariant, as: 'variants' },
    ],
  });
  if (!product) return [];
  const vendor = (product as Product & { vendor?: Vendor }).vendor ?? null;
  if (!isProductCustomerVisible(product, vendor)) return [];

  const variants = ((product as Product & { variants?: ProductVariant[] }).variants ?? []).slice();
  variants.sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0));
  // The variant being looked at; before one is chosen, the lowest price.
  const variant = variants.find((row) => row.id === variantId) ?? variants[0];
  if (!variant) return [];
  await markAboveMrp([variant], () => product);

  const quantity = 1;
  const availability = resolveItemAvailability({
    product,
    vendor,
    stock: Number(variant.stock ?? 0),
    quantity,
    aboveMrp: variant.aboveMrp,
  });
  if (!availability.isAvailable) return [];

  return gstInclusiveCouponLines([
    {
      productId: String(product.id),
      variantId: String(variant.id),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(variant.price ?? product.basePrice ?? 0),
      quantity,
      weightGrams: Number(variant.weightGrams ?? 500),
      isCustomerVisible: true,
    },
  ], await defaultShippingState(userId));
}
