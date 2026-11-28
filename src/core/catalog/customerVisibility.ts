import {
  CATEGORY_STATUS,
  PRODUCT_STATUS,
  VENDOR_STATUS,
  UNAVAILABLE_REASON,
  type UnavailableReason,
} from '@core/constants/statuses';

type CategoryLike = { status?: string } | null | undefined;
type ProductLike =
  | { status?: string; name?: string | null; aboveMrp?: boolean | null; Category?: CategoryLike; category?: CategoryLike }
  | null
  | undefined;
type VendorLike = { status?: string; kycVerified?: boolean | null } | null | undefined;

/**
 * A vendor can sell only while it is APPROVED and every KYC document it needs is
 * verified (`kycVerified`, kept current as documents and categories change). A
 * re-uploaded, rejected or newly required document stops its sales until verified.
 */
export function isVendorSellable(vendor: VendorLike): boolean {
  return vendor?.status === VENDOR_STATUS.APPROVED && vendor?.kycVerified === true;
}

/**
 * Whether the listing is published: LIVE, in an ACTIVE category and not a seed placeholder.
 * Load products with `PURCHASABLE_PRODUCT_INCLUDE`: without its category a product reads as off sale.
 */
function isPublished(product: ProductLike): boolean {
  const category = product?.Category ?? product?.category;
  return (
    product?.status === PRODUCT_STATUS.LIVE &&
    category?.status === CATEGORY_STATUS.ACTIVE &&
    !/^seed /i.test(product.name ?? '')
  );
}

/**
 * Single source of truth for customer-facing catalog visibility (the `customerVisible` scope):
 * published, with at least one price within the MRP, from a vendor who can sell.
 */
export function isProductCustomerVisible(product: ProductLike, vendor: VendorLike): boolean {
  return isPublished(product) && !product?.aboveMrp && isVendorSellable(vendor);
}

export function resolveUnavailableReason(args: {
  product: ProductLike;
  vendor: VendorLike;
  stock: number;
  quantity: number;
  /** The variant, or its product, has been deleted. */
  removed?: boolean;
  /** Whether the variant being bought is above the MRP; without it the product's own flag decides. */
  aboveMrp?: boolean | null;
}): UnavailableReason | null {
  if (args.removed) {
    return UNAVAILABLE_REASON.VARIANT_REMOVED;
  }
  if (!isVendorSellable(args.vendor)) {
    return UNAVAILABLE_REASON.VENDOR_UNAVAILABLE;
  }
  if (!isPublished(args.product)) {
    return UNAVAILABLE_REASON.PRODUCT_UNPUBLISHED;
  }
  if (args.aboveMrp ?? args.product?.aboveMrp) {
    return UNAVAILABLE_REASON.PRICE_ABOVE_MRP;
  }
  if (args.stock < args.quantity) {
    return args.stock > 0 ? UNAVAILABLE_REASON.LOW_STOCK : UNAVAILABLE_REASON.OUT_OF_STOCK;
  }
  return null;
}

export function resolveItemAvailability(args: {
  product: ProductLike;
  vendor: VendorLike;
  stock: number;
  quantity: number;
  aboveMrp?: boolean | null;
  removed?: boolean;
}): { isAvailable: boolean; unavailableReason: UnavailableReason | null } {
  const unavailableReason = resolveUnavailableReason(args);
  return { isAvailable: unavailableReason === null, unavailableReason };
}

/** Whether a loaded cart variant, or its product, has been deleted since the line was added. */
export function isRemoved(variant: { deletedAt?: Date | null; product?: { deletedAt?: Date | null } | null } | null | undefined): boolean {
  return !variant || Boolean(variant.deletedAt || variant.product?.deletedAt);
}
