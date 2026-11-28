import type { NotificationType } from '@database/models/notificationLog.model';

export type EmailAudience = 'customer' | 'vendor' | 'admin';

export type EmailMeta = {
  audience: EmailAudience;
  /** Short label shown above the heading and used to group templates in the admin preview. */
  group: string;
};

const GROUPS: Array<[EmailAudience, string, NotificationType[]]> = [
  ['customer', 'Account & security', ['EMAIL_VERIFICATION', 'PASSWORD_RESET', 'LOGIN_OTP', 'WELCOME', 'PASSWORD_CHANGED', 'NEW_DEVICE_LOGIN', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED']],
  ['customer', 'Your order', ['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT', 'PAYMENT_FAILED', 'SUBORDER_SHIPPED', 'ORDER_OUT_FOR_DELIVERY', 'SUBORDER_DELIVERED', 'DELIVERY_ATTEMPT_FAILED', 'ORDER_CANCELLED', 'SUBORDER_CANCELLED', 'CHECKOUT_PAYMENT_PENDING', 'CHECKOUT_EXPIRED']],
  ['customer', 'Returns & refunds', ['ORDER_RETURNED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURN_PICKUP_SCHEDULED', 'RETURN_RECEIVED', 'REFUND_INITIATED', 'REFUND_PROCESSED']],
  ['customer', 'Wallet & gift cards', ['WALLET_RECHARGE_SUCCESS', 'WALLET_RECHARGE_FAILED', 'CASHBACK_CREDITED', 'POINTS_EXPIRING', 'GIFT_CARD_PURCHASED', 'GIFT_CARD_RECEIVED', 'GIFT_CARD_REDEEMED']],
  ['customer', 'Support', ['TICKET_CREATED', 'TICKET_REPLIED', 'TICKET_RESOLVED', 'TICKET_REOPENED', 'TICKET_AUTO_CLOSED', 'TICKET_REOPEN_WINDOW_ENDING', 'BUG_REPORT_TRIAGED', 'BUG_REPORT_FIXED', 'BUG_REPORT_WONT_FIX', 'BUG_REPORT_DUPLICATE', 'CONTACT_ACKNOWLEDGEMENT']],
  ['customer', 'Reviews & questions', ['REVIEW_REQUEST', 'REVIEW_PUBLISHED', 'REVIEW_REJECTED', 'REVIEW_REPLIED', 'QUESTION_ANSWERED']],
  ['customer', 'Newsletter & offers', ['NEWSLETTER_CONFIRM', 'NEWSLETTER_WELCOME', 'NEWSLETTER_UNSUBSCRIBED', 'ABANDONED_CART', 'PRICE_DROP_ALERT', 'BACK_IN_STOCK', 'STOCK_ALERT_REQUESTED', 'STOCK_ALERT_CONFIRMED', 'WISHLIST_DIGEST', 'COUPON_OFFER_EXPIRING', 'ADMIN_BROADCAST']],
  ['vendor', 'Seller account', ['VENDOR_APPLICATION_RECEIVED', 'VENDOR_APPROVED', 'VENDOR_REJECTED', 'VENDOR_SUSPENDED', 'KYC_DOCUMENT_RECEIVED', 'KYC_DOCUMENT_APPROVED', 'KYC_DOCUMENT_REJECTED', 'KYC_PENDING_REMINDER', 'VENDOR_STAFF_INVITE', 'VENDOR_STAFF_ROLE_CHANGED']],
  ['vendor', 'Seller orders', ['VENDOR_NEW_ORDER', 'VENDOR_ORDER_CANCELLED', 'VENDOR_RETURN_REQUESTED', 'VENDOR_NEW_QUESTION', 'VENDOR_NEW_REVIEW']],
  ['vendor', 'Seller catalog', ['PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'PRODUCT_LISTED_BY_PLATFORM', 'PRODUCT_UPDATED_BY_PLATFORM', 'PRODUCT_SUBMITTED_BY_PLATFORM', 'PRODUCT_ABOVE_MRP', 'LOW_STOCK_ALERT', 'COUPON_USAGE_LIMIT', 'COUPON_EXPIRING']],
  ['vendor', 'Seller payouts', ['PAYOUT_PROCESSED', 'PAYOUT_PAID', 'PAYOUT_FAILED', 'COMMISSION_INVOICE_READY', 'VENDOR_WEEKLY_SUMMARY']],
  ['admin', 'Admin alerts', ['ADMIN_NEW_VENDOR_PENDING', 'ADMIN_RETURN_ESCALATION', 'ADMIN_NEW_BUG_REPORT', 'ADMIN_CONTACT_ENQUIRY', 'ADMIN_SETTINGS_CHANGED', 'ADMIN_DAILY_DIGEST']],
];

const META = new Map<NotificationType, EmailMeta>();
for (const [audience, group, types] of GROUPS) {
  for (const type of types) META.set(type, { audience, group });
}

/** Where a type belongs. Anything unlisted is treated as a customer service email. */
export function emailMeta(type: NotificationType): EmailMeta {
  return META.get(type) ?? { audience: 'customer', group: 'Notification' };
}

export function allEmailTypes(): NotificationType[] {
  return [...META.keys()];
}

/** Sign-in and account-protection mail: the footer tells the reader how to lock the account. */
export const SECURITY_TYPES = new Set<NotificationType>([
  'PASSWORD_RESET', 'LOGIN_OTP', 'PASSWORD_CHANGED', 'NEW_DEVICE_LOGIN',
  'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED',
]);

export const MARKETING_TYPES = new Set<NotificationType>([
  'REVIEW_REQUEST', 'ABANDONED_CART', 'PRICE_DROP_ALERT', 'BACK_IN_STOCK',
  'COUPON_OFFER_EXPIRING', 'WISHLIST_DIGEST',
]);
