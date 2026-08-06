/** Machine-readable API error codes (response `error.code`). */
export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  REFRESH_REQUIRED: 'REFRESH_REQUIRED',
  SESSION_REQUIRED: 'SESSION_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  CONFIG_ERROR: 'CONFIG_ERROR',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  RAZORPAY_NOT_CONFIGURED: 'RAZORPAY_NOT_CONFIGURED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  ITEMS_UNAVAILABLE: 'ITEMS_UNAVAILABLE',
  VENDOR_UNAVAILABLE: 'VENDOR_UNAVAILABLE',
  COUPON_INACTIVE: 'COUPON_INACTIVE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Repeated error messages (2+ call sites). One-off messages stay inline. */
export const ERROR_MESSAGES = {
  INSUFFICIENT_STOCK: 'Insufficient stock',
  COUPON_USAGE_LIMIT: 'Coupon usage limit reached',
  CART_EMPTY: 'Cart is empty',
  AUTH_REQUIRED: 'Authentication required',
  INVALID_TOKEN: 'Invalid token',
  TOKEN_EXPIRED: 'Token expired',
  USER_NOT_FOUND_OR_BLOCKED: 'User not found or blocked',
  REFRESH_REQUIRED: 'Refresh token required',
  SESSION_REQUIRED: 'Current session cookie required',
  INTERNAL_ERROR: 'Something went wrong',
  RATE_LIMITED: 'Too many requests, please try again later.',
  NOT_YOUR_ORDER: 'Not your order',
  NO_ACCESS_TO_ORDER: 'You do not have access to this order',
  RAZORPAY_NOT_CONFIGURED: 'Razorpay is not configured',
  NOT_YOUR_PRODUCT: 'Not your product',
  INVALID_CREDENTIALS: 'Invalid credentials',
  VENDOR_NOT_PENDING: 'Vendor is not in PENDING status',
  PRODUCT_NAME_EXISTS: 'Product name already exists',
  CATEGORY_NAME_EXISTS: 'Category name already exists',
  ITEMS_UNAVAILABLE: 'Some items in your cart are no longer available',
  VENDOR_UNAVAILABLE: 'This seller is currently unavailable',
  COUPON_INACTIVE: 'Coupon is not active',
  SHOP_UNAVAILABLE: 'This shop is currently unavailable',
} as const;
