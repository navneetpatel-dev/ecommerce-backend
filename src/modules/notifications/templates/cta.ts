import type { NotificationType } from '@database/models/notificationLog.model';
import { env } from '@config/env';
import { EMAIL_COPY } from '../emailCopy';
import {
  bugReportPortalUrl,
  customerOrderUrl,
  customerReturnUrl,
  ticketPortalUrlForGroup,
  vendorDashboardUrl,
  walletUrl,
} from '../portalLinks';

export type EmailTemplateData = Record<string, unknown>;

export function str(data: EmailTemplateData, key: string, fallback = ''): string {
  const value = data[key];
  if (value == null) return fallback;
  return typeof value === 'object' ? fallback : String(value);
}

const ORDER_TYPES = new Set<NotificationType>([
  'ORDER_CONFIRMATION', 'PAYMENT_RECEIPT', 'PAYMENT_FAILED', 'ORDER_CANCELLED', 'SUBORDER_CANCELLED',
  'ORDER_RETURNED', 'REFUND_PROCESSED', 'REFUND_INITIATED', 'SUBORDER_SHIPPED', 'SUBORDER_DELIVERED',
  'ORDER_OUT_FOR_DELIVERY', 'CHECKOUT_PAYMENT_PENDING',
]);
const RETURN_TYPES = new Set<NotificationType>([
  'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURN_PICKUP_SCHEDULED', 'RETURN_RECEIVED',
]);
const VENDOR_TYPES = new Set<NotificationType>([
  'VENDOR_APPROVED', 'VENDOR_NEW_ORDER', 'LOW_STOCK_ALERT', 'PAYOUT_PROCESSED', 'PAYOUT_PAID', 'PAYOUT_FAILED',
  'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'PRODUCT_LISTED_BY_PLATFORM', 'PRODUCT_UPDATED_BY_PLATFORM',
  'PRODUCT_SUBMITTED_BY_PLATFORM', 'PRODUCT_ABOVE_MRP', 'COUPON_APPROVED', 'COUPON_REJECTED', 'COUPON_USAGE_LIMIT', 'COUPON_EXPIRING', 'KYC_DOCUMENT_RECEIVED',
  'KYC_DOCUMENT_APPROVED', 'KYC_PENDING_REMINDER', 'VENDOR_RETURN_REQUESTED',
  'VENDOR_NEW_QUESTION', 'VENDOR_NEW_REVIEW', 'COMMISSION_INVOICE_READY', 'VENDOR_WEEKLY_SUMMARY',
]);

/** The button an email carries when the sender passes no `actionUrl`. Every path is a real web page. */
export function defaultCta(type: NotificationType, data: EmailTemplateData): { label?: string; url?: string } {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  const action = (fallback: string) => str(data, 'actionUrl', fallback);

  if (ORDER_TYPES.has(type)) {
    const label = type === 'CHECKOUT_PAYMENT_PENDING' ? EMAIL_COPY.ctaFinishCheckout : EMAIL_COPY.ctaViewOrder;
    return { label, url: action(customerOrderUrl(str(data, 'orderId'))) };
  }
  if (RETURN_TYPES.has(type)) {
    return { label: EMAIL_COPY.ctaViewReturn, url: action(customerReturnUrl(str(data, 'returnId'))) };
  }
  if (VENDOR_TYPES.has(type)) {
    return { label: EMAIL_COPY.ctaVendorDashboard, url: action(vendorDashboardUrl(type)) };
  }

  switch (type) {
    case 'EMAIL_VERIFICATION':
      return { label: EMAIL_COPY.ctaVerifyEmail, url: action(`${base}/verify-email`) };
    case 'PASSWORD_RESET':
      return { label: EMAIL_COPY.ctaResetPassword, url: action(`${base}/reset-password`) };
    case 'LOGIN_OTP':
      return { label: 'Enter sign-in code', url: action(`${base}/otp`) };
    case 'PASSWORD_CHANGED':
    case 'NEW_DEVICE_LOGIN':
      return { label: EMAIL_COPY.ctaSecureAccount, url: action(`${base}/forgot-password`) };
    case 'ACCOUNT_DEACTIVATED':
      return { label: 'Contact support', url: action(`${base}/contact`) };
    case 'ACCOUNT_REACTIVATED':
      return { label: 'Sign in', url: action(`${base}/login`) };
    case 'WELCOME':
    case 'NEWSLETTER_WELCOME':
      return { label: EMAIL_COPY.ctaShopNow, url: action(`${base}/products`) };
    case 'NEWSLETTER_CONFIRM':
      return { label: EMAIL_COPY.ctaConfirmSubscription, url: action(`${base}/newsletter/confirm`) };
    case 'NEWSLETTER_UNSUBSCRIBED':
      return { label: EMAIL_COPY.ctaOpenStore, url: base };
    case 'CONTACT_ACKNOWLEDGEMENT':
      return { label: 'Browse help articles', url: action(`${base}/help`) };
    case 'WALLET_RECHARGE_FAILED':
    case 'WALLET_RECHARGE_SUCCESS':
    case 'POINTS_EXPIRING':
      return { label: EMAIL_COPY.ctaViewWallet, url: action(walletUrl()) };
    case 'CASHBACK_CREDITED':
      return { label: EMAIL_COPY.ctaViewWallet, url: action(`${base}/wallet/cashback`) };
    case 'GIFT_CARD_PURCHASED':
    case 'GIFT_CARD_REDEEMED':
      return { label: 'View gift cards', url: action(`${base}/gift-cards/mine`) };
    case 'GIFT_CARD_RECEIVED':
      return { label: EMAIL_COPY.ctaRedeemGiftCard, url: action(`${base}/gift-cards`) };
    case 'CHECKOUT_EXPIRED':
    case 'ABANDONED_CART':
    case 'COUPON_OFFER_EXPIRING':
      return { label: EMAIL_COPY.ctaViewCart, url: action(`${base}/cart`) };
    case 'REVIEW_REQUEST':
      return { label: EMAIL_COPY.ctaLeaveReview, url: action(customerOrderUrl(str(data, 'orderId'))) };
    case 'REVIEW_PUBLISHED':
    case 'REVIEW_REJECTED':
    case 'REVIEW_REPLIED':
    case 'QUESTION_ANSWERED':
    case 'PRICE_DROP_ALERT':
    case 'BACK_IN_STOCK':
    case 'STOCK_ALERT_REQUESTED':
    case 'STOCK_ALERT_CONFIRMED':
      return { label: EMAIL_COPY.ctaViewProduct, url: action(str(data, 'productUrl', `${base}/products`)) };
    case 'WISHLIST_DIGEST':
      return { label: EMAIL_COPY.ctaViewWishlist, url: action(`${base}/wishlist`) };
    case 'DELIVERY_ATTEMPT_FAILED':
      return { label: EMAIL_COPY.ctaTrackShipment, url: action(`${base}/orders/tracking`) };
    case 'ADMIN_NEW_VENDOR_PENDING':
      return { label: EMAIL_COPY.ctaOpenAdmin, url: action(`${base}/admin/vendors`) };
    case 'ADMIN_RETURN_ESCALATION':
      return { label: EMAIL_COPY.ctaOpenAdmin, url: action(`${base}/admin/returns`) };
    case 'ADMIN_VENDOR_PRODUCT_EDITED':
      return { label: EMAIL_COPY.ctaOpenAdmin, url: action(`${base}/admin/products?search=${encodeURIComponent(str(data, 'productName'))}`) };
    case 'ADMIN_NEW_BUG_REPORT':
      return { label: EMAIL_COPY.ctaViewBugReport, url: action(`${base}/admin/bug-reports/${str(data, 'bugReportId')}`) };
    case 'ADMIN_CONTACT_ENQUIRY': {
      const email = str(data, 'senderEmail');
      return email ? { label: 'Reply to sender', url: action(`mailto:${email}`) } : {};
    }
    case 'ADMIN_SETTINGS_CHANGED':
      return { label: 'Review settings', url: action(`${base}/admin/settings`) };
    case 'ADMIN_DAILY_DIGEST':
      return { label: EMAIL_COPY.ctaOpenAdmin, url: action(`${base}/admin`) };
    case 'TICKET_CREATED':
    case 'TICKET_REPLIED':
    case 'TICKET_RESOLVED':
    case 'TICKET_REOPENED':
    case 'TICKET_AUTO_CLOSED':
    case 'TICKET_REOPEN_WINDOW_ENDING': {
      const group = str(data, 'portalGroup', 'customer');
      const portal = group === 'admin' || group === 'vendor' ? group : 'customer';
      return { label: EMAIL_COPY.ctaViewTicket, url: action(ticketPortalUrlForGroup(str(data, 'ticketId'), portal)) };
    }
    case 'BUG_REPORT_TRIAGED':
    case 'BUG_REPORT_FIXED':
    case 'BUG_REPORT_WONT_FIX':
    case 'BUG_REPORT_DUPLICATE': {
      const bugReportId = str(data, 'bugReportId');
      const reporterRole = str(data, 'reporterRole');
      const fallback =
        bugReportId && reporterRole
          ? bugReportPortalUrl(bugReportId, reporterRole)
          : `${base}/support/bug-reports/${bugReportId}`;
      return { label: EMAIL_COPY.ctaViewBugReport, url: action(fallback) };
    }
    default:
      return { label: EMAIL_COPY.ctaOpenStore, url: base };
  }
}
