/** Repeated error messages (2+ call sites). One-off messages stay inline. */
export const ERROR_MESSAGES = {
  INSUFFICIENT_STOCK: 'Insufficient stock',
  COUPON_USAGE_LIMIT: 'Coupon usage limit reached',
  CART_EMPTY: 'Cart is empty',
  AUTH_REQUIRED: 'Authentication required',
  NOT_YOUR_ORDER: 'Not your order',
  NO_ACCESS_TO_ORDER: 'You do not have access to this order',
  RAZORPAY_NOT_CONFIGURED: 'Razorpay is not configured',
  NOT_YOUR_PRODUCT: 'Not your product',
  INVALID_CREDENTIALS: 'Invalid credentials',
  VENDOR_NOT_PENDING: 'Vendor is not in PENDING status',
  PRODUCT_NAME_EXISTS: 'Product name already exists',
  CATEGORY_NAME_EXISTS: 'Category name already exists',
} as const;
