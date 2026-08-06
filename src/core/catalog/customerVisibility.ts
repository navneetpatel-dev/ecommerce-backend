import {
  PRODUCT_STATUS,
  VENDOR_STATUS,
  UNAVAILABLE_REASON,
  type UnavailableReason,
} from '@core/constants/statuses';

type StatusLike = { status?: string } | null | undefined;

/**
 * Single source of truth for customer-facing catalog visibility.
 * Product is visible iff LIVE and its vendor is APPROVED.
 */
export function isProductCustomerVisible(product: StatusLike, vendor: StatusLike): boolean {
  return product?.status === PRODUCT_STATUS.LIVE && vendor?.status === VENDOR_STATUS.APPROVED;
}

export function resolveUnavailableReason(args: {
  product: StatusLike;
  vendor: StatusLike;
  stock: number;
  quantity: number;
}): UnavailableReason | null {
  if (!args.vendor || args.vendor.status !== VENDOR_STATUS.APPROVED) {
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
  vendor: StatusLike;
  stock: number;
  quantity: number;
}): { isAvailable: boolean; unavailableReason: UnavailableReason | null } {
  const unavailableReason = resolveUnavailableReason(args);
  return { isAvailable: unavailableReason === null, unavailableReason };
}
