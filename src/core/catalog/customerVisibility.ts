import {
  PRODUCT_STATUS,
  VENDOR_STATUS,
  UNAVAILABLE_REASON,
  type UnavailableReason,
} from '@core/constants/statuses';

type StatusLike = { status?: string } | null | undefined;
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
 * Single source of truth for customer-facing catalog visibility.
 * Product is visible iff LIVE and its vendor can sell (`isVendorSellable`).
 */
export function isProductCustomerVisible(product: StatusLike, vendor: VendorLike): boolean {
  return product?.status === PRODUCT_STATUS.LIVE && isVendorSellable(vendor);
}

export function resolveUnavailableReason(args: {
  product: StatusLike;
  vendor: VendorLike;
  stock: number;
  quantity: number;
}): UnavailableReason | null {
  if (!isVendorSellable(args.vendor)) {
    return UNAVAILABLE_REASON.VENDOR_UNAVAILABLE;
  }
  if (!args.product || args.product.status !== PRODUCT_STATUS.LIVE) {
    return UNAVAILABLE_REASON.PRODUCT_UNPUBLISHED;
  }
  if (args.stock < args.quantity) {
    return UNAVAILABLE_REASON.OUT_OF_STOCK;
  }
  return null;
}

export function resolveItemAvailability(args: {
  product: StatusLike;
  vendor: VendorLike;
  stock: number;
  quantity: number;
}): { isAvailable: boolean; unavailableReason: UnavailableReason | null } {
  const unavailableReason = resolveUnavailableReason(args);
  return { isAvailable: unavailableReason === null, unavailableReason };
}
