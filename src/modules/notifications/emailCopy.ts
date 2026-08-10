import type { NotificationType } from '@database/models/notificationLog.model';

/** Centralized email copy — no inline subject/body strings at call sites. */
export const EMAIL_COPY = {
  brandName: 'Ecommerce',
  footerHelp: 'If you did not expect this email, you can ignore it.',
  footerUnsubscribe:
    'You received this because you opted in to marketing emails. Manage preferences in your account settings.',
  ctaOpenStore: 'Visit store',
  ctaResetPassword: 'Reset password',
  ctaVerifyEmail: 'Verify email',
  ctaViewOrder: 'View order',
  ctaTrackShipment: 'Track shipment',
  ctaLeaveReview: 'Leave a review',
  ctaViewCart: 'Return to cart',
  ctaVendorDashboard: 'Open vendor dashboard',
  ctaDownloadReport: 'Download report',
  ctaViewTicket: 'View ticket',
  ctaViewBugReport: 'View bug report',

  subjects: {
    EMAIL_VERIFICATION: 'Verify your email address',
    PASSWORD_RESET: 'Reset your password',
    WELCOME: 'Welcome aboard',
    ORDER_CONFIRMATION: 'Order confirmed — #{orderNumber}',
    VENDOR_NEW_ORDER: 'New order received — #{orderNumber}',
    PAYMENT_RECEIPT: 'Payment receipt — #{orderNumber}',
    PAYMENT_FAILED: 'Payment failed — #{orderNumber}',
    SUBORDER_SHIPPED: 'Your order has shipped — #{orderNumber}',
    SUBORDER_DELIVERED: 'Delivered — #{orderNumber}',
    REVIEW_REQUEST: 'How was your order?',
    ORDER_CANCELLED: 'Order cancelled — #{orderNumber}',
    ORDER_RETURNED: 'Return update — #{orderNumber}',
    REFUND_PROCESSED: 'Refund processed — #{orderNumber}',
    VENDOR_APPLICATION_RECEIVED: 'We received your vendor application',
    VENDOR_APPROVED: 'Your vendor account is approved',
    VENDOR_REJECTED: 'Vendor application update',
    VENDOR_SUSPENDED: 'Vendor account suspended',
    PRODUCT_APPROVED: 'Product approved — {productName}',
    PRODUCT_REJECTED: 'Product needs changes — {productName}',
    KYC_DOCUMENT_REJECTED: 'Document rejected',
    LOW_STOCK_ALERT: 'Low stock alert — {productName}',
    PAYOUT_PROCESSED: 'Payout processed',
    PAYOUT_FAILED: 'Payout failed',
    ABANDONED_CART: 'You left items in your cart',
    PRICE_DROP_ALERT: 'Price drop on a wishlist item',
    BACK_IN_STOCK: 'Back in stock',
    ADMIN_NEW_VENDOR_PENDING: 'New vendor application pending',
    COUPON_USAGE_LIMIT: 'Coupon nearing usage limit — {code}',
    COUPON_EXPIRING: 'Coupon expiring soon — {code}',
    COUPON_OFFER_EXPIRING: 'Offer expiring soon — {code}',
    REPORT_EXPORT_READY: 'Your report export is ready — {reportType}',
    TICKET_CREATED: 'New support ticket — {ticketNumber}',
    TICKET_REPLIED: 'New reply on ticket — {ticketNumber}',
    TICKET_RESOLVED: 'Ticket resolved — {ticketNumber}',
    TICKET_REOPENED: 'Ticket reopened — {ticketNumber}',
    BUG_REPORT_TRIAGED: 'Bug report triaged — {reportNumber}',
    BUG_REPORT_FIXED: 'Bug report fixed — {reportNumber}',
    BUG_REPORT_WONT_FIX: 'Bug report update — {reportNumber}',
  } satisfies Record<NotificationType, string>,

  greetings: {
    withName: 'Hi {name},',
    anonymous: 'Hi,',
  },

  bodies: {
    EMAIL_VERIFICATION:
      'Please verify your email address to secure your account and complete setup.',
    PASSWORD_RESET:
      'We received a request to reset your password. Use the button below. This link expires soon.',
    WELCOME: 'Your email is verified. Thanks for joining {brand}. Happy shopping!',
    ORDER_CONFIRMATION: 'Your order #{orderNumber} is confirmed. Total: ₹{total}.',
    VENDOR_NEW_ORDER: 'You have a new order #{orderNumber}. Subtotal: ₹{subtotal}.',
    PAYMENT_RECEIPT: 'We received payment for order #{orderNumber}. Amount: ₹{total}.',
    PAYMENT_FAILED:
      'Payment for order #{orderNumber} failed. You can retry checkout from your cart.',
    SUBORDER_SHIPPED:
      'Part of order #{orderNumber} has shipped{trackingSuffix}.',
    SUBORDER_DELIVERED: 'Your items for order #{orderNumber} were delivered.',
    REVIEW_REQUEST: 'How was your recent order #{orderNumber}? Your review helps other shoppers.',
    ORDER_CANCELLED: 'Order #{orderNumber} has been cancelled.',
    ORDER_RETURNED: 'Your return for order #{orderNumber} has been updated ({status}).',
    REFUND_PROCESSED: 'A refund of ₹{amount} for order #{orderNumber} has been processed.',
    VENDOR_APPLICATION_RECEIVED:
      'We received your vendor application for {businessName}. We will review it shortly.',
    VENDOR_APPROVED: 'Congratulations — {businessName} is approved. You can start listing products.',
    VENDOR_REJECTED: 'Your vendor application for {businessName} was not approved. Reason: {reason}',
    VENDOR_SUSPENDED: 'Your vendor account {businessName} has been suspended. Reason: {reason}',
    PRODUCT_APPROVED: 'Your product "{productName}" is now live.',
    PRODUCT_REJECTED: 'Your product "{productName}" was rejected. Note: {reason}',
    KYC_DOCUMENT_REJECTED: 'A KYC document was rejected. Reason: {reason}',
    LOW_STOCK_ALERT: 'Stock for "{productName}" ({sku}) is low: {stock} remaining.',
    PAYOUT_PROCESSED: 'A payout of ₹{amount} has been processed.',
    PAYOUT_FAILED: 'A payout of ₹{amount} failed{businessNameSuffix}. Reason: {reason}',
    ABANDONED_CART: 'You still have items waiting in your cart. Complete checkout before they sell out.',
    PRICE_DROP_ALERT: '"{productName}" dropped to ₹{price}.',
    BACK_IN_STOCK: '"{productName}" is back in stock.',
    ADMIN_NEW_VENDOR_PENDING: 'Vendor "{businessName}" submitted an application and awaits review.',
    COUPON_USAGE_LIMIT: 'Coupon {code} has used {usedCount} of {usageLimit} redemptions.',
    COUPON_EXPIRING: 'Coupon {code} expires on {expiresAt}.',
    COUPON_OFFER_EXPIRING: 'Your offer {code} expires on {expiresAt}. Apply it before it ends.',
    REPORT_EXPORT_READY:
      'Your {reportType} export ({rowCount} rows) is ready. Use the button below to download the Excel file from your account session.',
    TICKET_CREATED: 'A new support ticket {ticketNumber} was created: {subject}.',
    TICKET_REPLIED: 'There is a new reply on support ticket {ticketNumber} ({subject}).',
    TICKET_RESOLVED: 'Your support ticket {ticketNumber} ({subject}) has been resolved.',
    TICKET_REOPENED: 'Support ticket {ticketNumber} ({subject}) was reopened by the customer.',
    BUG_REPORT_TRIAGED: 'Your bug report {reportNumber} ({title}) has been triaged.',
    BUG_REPORT_FIXED: 'Your bug report {reportNumber} ({title}) has been marked fixed.',
    BUG_REPORT_WONT_FIX:
      'Your bug report {reportNumber} ({title}) will not be fixed. Reason: {reason}',
  } satisfies Record<NotificationType, string>,
} as const;

export const NOTIFICATION_SYSTEM_MESSAGES = {
  queuedForDelivery: 'Queued for delivery',
} as const;

export function formatEmailCopy(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}
