/** Canonical permission keys — must match `database/seeders/20240101000001-seed-roles-permissions.js`. */
import { ROLES } from '@core/constants/statuses';
export const PERMISSIONS = {
  USER_MANAGE: 'user.manage',
  VENDOR_MANAGE: 'vendor.manage',
  VENDOR_APPROVE: 'vendor.approve',
  PRODUCT_MANAGE: 'product.manage',
  PRODUCT_APPROVE: 'product.approve',
  CATEGORY_MANAGE: 'category.manage',
  ORDER_MANAGE: 'order.manage',
  ORDER_REFUND: 'order.refund',
  COUPON_MANAGE: 'coupon.manage',
  COMMISSION_VIEW: 'commission.view',
  PAYOUT_MANAGE: 'payout.manage',
  REVIEW_MODERATE: 'review.moderate',
  TAX_MANAGE: 'tax.manage',
  SHIPPING_MANAGE: 'shipping.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  ANALYTICS_VIEW: 'analytics.view',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  SUBORDER_MANAGE: 'suborder.manage',
  PAYOUT_VIEW: 'payout.view',
  REVIEW_RESPOND: 'review.respond',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_KEYS = Object.values(PERMISSIONS) as PermissionKey[];

export const ROLE_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: PERMISSION_KEYS,
  [ROLES.ADMIN_ORDER_MANAGER]: [
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ],
  [ROLES.ADMIN_CATALOG_MANAGER]: [
    PERMISSIONS.PRODUCT_MANAGE,
    PERMISSIONS.PRODUCT_APPROVE,
    PERMISSIONS.CATEGORY_MANAGE,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
  ],
  [ROLES.VENDOR_OWNER]: [
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.SUBORDER_MANAGE,
    PERMISSIONS.PAYOUT_VIEW,
    PERMISSIONS.REVIEW_RESPOND,
  ],
  [ROLES.VENDOR_STAFF]: [PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.SUBORDER_MANAGE],
  [ROLES.CUSTOMER]: [],
};
