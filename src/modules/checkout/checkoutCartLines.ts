import type { CartItem } from '@database/models/cartItem.model';
import type { ProductVariant } from '@database/models/productVariant.model';
import { resolveCartCouponCodes, type CartLineForCoupon } from '@modules/coupons/couponEngine';
import { PLATFORM_VENDOR_ID, type PricedLine } from './vendorPricingPlan';
import { withGstInclusiveLineValues } from './gstInclusiveLines';

/** Cart rows as checkout loads them: each with its variant and product. */
type CheckoutCartItem = CartItem & { variant: ProductVariant & { product: any } };

export function catalogItemsForCod(items: CheckoutCartItem[]) {
  return items.map((item) => {
    const product = item.variant?.product;
    return {
      categoryId: product?.categoryId ?? null,
      codEnabled: product?.codEnabled ?? null,
      vendor: product?.vendor ?? product?.Vendor ?? null,
    };
  });
}

/** Coupon lines at the prices the customer sees (GST included): coupons are set in those terms. */
export function toCouponLines(
  items: CheckoutCartItem[],
  shippingStateCode: string,
): Promise<CartLineForCoupon[]> {
  const lines = items.map((item) => {
    const product = item.variant.product;
    return {
      productId: String(product.id),
      variantId: String(item.variantId),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      vendorId: product.vendorId ? String(product.vendorId) : null,
      unitPrice: Number(item.variant.price),
      quantity: Number(item.quantity),
      weightGrams: Number(item.variant.weightGrams ?? 500),
      isCustomerVisible: true,
    };
  });
  return withGstInclusiveLineValues(lines, shippingStateCode);
}

export function resolveCheckoutCouponCodes(
  data: { couponCode?: string | null; couponCodes?: string[] },
  cart: { couponCode?: string | null; couponCodes?: string[] | null },
): string[] {
  if (data.couponCodes && data.couponCodes.length > 0) {
    return [...new Set(data.couponCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  }
  if (data.couponCode?.trim()) {
    return [data.couponCode.trim().toUpperCase()];
  }
  return resolveCartCouponCodes(cart);
}

/** Map cart rows into the normalized shape `vendorPricingPlan` prices. */
export function toPricedLines(items: CheckoutCartItem[]): PricedLine[] {
  return items.map((item) => ({
    key: String(item.id),
    vendorId: item.variant.product.vendorId || PLATFORM_VENDOR_ID,
    unitPrice: Number(item.variant.price),
    quantity: Number(item.quantity),
    categoryId: item.variant.product.categoryId ?? null,
    weightGrams: item.variant.weightGrams ?? null,
  }));
}
