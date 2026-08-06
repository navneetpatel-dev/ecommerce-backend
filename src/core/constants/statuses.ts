/** Domain status / method enums — keep identical to Sequelize model ENUM values. */

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS) as [OrderStatus, ...OrderStatus[]];

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS) as [PaymentStatus, ...PaymentStatus[]];

export const PRODUCT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  LIVE: 'LIVE',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];
export const PRODUCT_STATUS_VALUES = Object.values(PRODUCT_STATUS) as [ProductStatus, ...ProductStatus[]];

export const VENDOR_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];
export const VENDOR_STATUS_VALUES = Object.values(VENDOR_STATUS) as [VendorStatus, ...VendorStatus[]];

/** Why a cart/wishlist line is not purchaseable (live catalog gate). */
export const UNAVAILABLE_REASON = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PRODUCT_UNPUBLISHED: 'PRODUCT_UNPUBLISHED',
  VENDOR_UNAVAILABLE: 'VENDOR_UNAVAILABLE',
} as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASON)[keyof typeof UNAVAILABLE_REASON];

export const CATEGORY_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CategoryStatus = (typeof CATEGORY_STATUS)[keyof typeof CATEGORY_STATUS];
export const CATEGORY_STATUS_VALUES = Object.values(CATEGORY_STATUS) as [CategoryStatus, ...CategoryStatus[]];

export const PROMO_BANNER_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PromoBannerStatus = (typeof PROMO_BANNER_STATUS)[keyof typeof PROMO_BANNER_STATUS];
export const PROMO_BANNER_STATUS_VALUES = Object.values(PROMO_BANNER_STATUS) as [
  PromoBannerStatus,
  ...PromoBannerStatus[],
];

export const PROMO_BANNER_LINK_TYPE = {
  PRODUCT: 'PRODUCT',
  CATEGORY: 'CATEGORY',
  VENDOR: 'VENDOR',
  URL: 'URL',
} as const;
export type PromoBannerLinkType = (typeof PROMO_BANNER_LINK_TYPE)[keyof typeof PROMO_BANNER_LINK_TYPE];
export const PROMO_BANNER_LINK_TYPE_VALUES = Object.values(PROMO_BANNER_LINK_TYPE) as [
  PromoBannerLinkType,
  ...PromoBannerLinkType[],
];

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export const USER_STATUS_VALUES = Object.values(USER_STATUS) as [UserStatus, ...UserStatus[]];

export const REVIEW_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];
export const REVIEW_STATUS_VALUES = Object.values(REVIEW_STATUS) as [ReviewStatus, ...ReviewStatus[]];

export const RETURN_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
} as const;
export type ReturnStatus = (typeof RETURN_STATUS)[keyof typeof RETURN_STATUS];
export const RETURN_STATUS_VALUES = Object.values(RETURN_STATUS) as [ReturnStatus, ...ReturnStatus[]];

export const RETURN_REASON = {
  DAMAGED: 'DAMAGED',
  WRONG_ITEM: 'WRONG_ITEM',
  NOT_AS_DESCRIBED: 'NOT_AS_DESCRIBED',
  NO_LONGER_NEEDED: 'NO_LONGER_NEEDED',
  OTHER: 'OTHER',
} as const;
export type ReturnReason = (typeof RETURN_REASON)[keyof typeof RETURN_REASON];
export const RETURN_REASON_VALUES = Object.values(RETURN_REASON) as [ReturnReason, ...ReturnReason[]];

export const SHIPMENT_STATUS = {
  PENDING: 'PENDING',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS)[keyof typeof SHIPMENT_STATUS];

export const SHIPPING_METHOD = {
  STANDARD: 'STANDARD',
  EXPRESS: 'EXPRESS',
} as const;
export type ShippingMethod = (typeof SHIPPING_METHOD)[keyof typeof SHIPPING_METHOD];
export const SHIPPING_METHOD_VALUES = Object.values(SHIPPING_METHOD) as [ShippingMethod, ...ShippingMethod[]];

export const PAYMENT_METHOD = {
  RAZORPAY: 'RAZORPAY',
  COD: 'COD',
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];
export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD) as [PaymentMethod, ...PaymentMethod[]];

export const COUPON_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  EXPIRED: 'EXPIRED',
} as const;

export const PAYOUT_STATUS = {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
} as const;

export const COMMISSION_STATUS = {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
} as const;

export const NOTIFICATION_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  BOUNCED: 'BOUNCED',
  COMPLAINED: 'COMPLAINED',
} as const;

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN_ORDER_MANAGER: 'ADMIN_ORDER_MANAGER',
  ADMIN_CATALOG_MANAGER: 'ADMIN_CATALOG_MANAGER',
  VENDOR_OWNER: 'VENDOR_OWNER',
  VENDOR_STAFF: 'VENDOR_STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;
export type RoleName = (typeof ROLES)[keyof typeof ROLES];
export const ROLE_VALUES = Object.values(ROLES) as [RoleName, ...RoleName[]];

/** Human-readable role names for login account picker. */
export const ROLE_LABELS: Record<RoleName, string> = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN_ORDER_MANAGER]: 'Order Manager',
  [ROLES.ADMIN_CATALOG_MANAGER]: 'Catalog Manager',
  [ROLES.VENDOR_OWNER]: 'Vendor Owner',
  [ROLES.VENDOR_STAFF]: 'Vendor Staff',
  [ROLES.CUSTOMER]: 'Customer',
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN_ORDER_MANAGER,
  ROLES.ADMIN_CATALOG_MANAGER,
] as const;

export const VENDOR_ROLES = [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF] as const;
