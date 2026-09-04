import type { NotificationType } from '@database/models/notificationLog.model';
import { env } from '@config/env';
import { EMAIL_COPY, formatEmailCopy } from '../emailCopy';
import { bugReportPortalUrl, ticketPortalUrlForGroup } from '../portalLinks';
import { escapeHtml, renderEmailLayout } from './layout';

export type EmailTemplateData = Record<string, unknown>;

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

function str(data: EmailTemplateData, key: string, fallback = ''): string {
  const value = data[key];
  if (value == null) return fallback;
  return String(value);
}

function greeting(data: EmailTemplateData): string {
  const name = str(data, 'customerName') || str(data, 'name');
  return name
    ? formatEmailCopy(EMAIL_COPY.greetings.withName, { name })
    : EMAIL_COPY.greetings.anonymous;
}

function subjectFor(type: NotificationType, data: EmailTemplateData): string {
  const template =
    EMAIL_COPY.subjects[type] ?? `Notification from ${EMAIL_COPY.brandName}`;
  return formatEmailCopy(template, {
    orderNumber: str(data, 'orderNumber', str(data, 'orderId', '')),
    productName: str(data, 'productName'),
    code: str(data, 'code'),
    expiresInMinutes: str(data, 'expiresInMinutes', '5'),
    brand: EMAIL_COPY.brandName,
    reportType: str(data, 'reportType'),
    ticketNumber: str(data, 'ticketNumber'),
    reportNumber: str(data, 'reportNumber'),
  });
}

function bodyFor(type: NotificationType, data: EmailTemplateData): string {
  const template =
    EMAIL_COPY.bodies[type] ??
    'You have a new notification from {brand}. Sign in to your account for details.';
  return formatEmailCopy(template, {
    brand: EMAIL_COPY.brandName,
    orderNumber: str(data, 'orderNumber', str(data, 'orderId')),
    total: str(data, 'total'),
    subtotal: str(data, 'subtotal'),
    amount: str(data, 'amount'),
    paymentMethod: str(data, 'paymentMethod'),
    paymentReferenceNumber: str(data, 'paymentReferenceNumber'),
    status: str(data, 'status'),
    reason: str(data, 'reason', '—'),
    businessName: str(data, 'businessName'),
    businessNameSuffix: str(data, 'businessName')
      ? ` for ${str(data, 'businessName')}`
      : '',
    productName: str(data, 'productName'),
    sku: str(data, 'sku'),
    stock: str(data, 'stock'),
    price: str(data, 'price'),
    code: str(data, 'code'),
    usedCount: str(data, 'usedCount'),
    usageLimit: str(data, 'usageLimit'),
    expiresAt: str(data, 'expiresAt'),
    trackingSuffix: str(data, 'trackingId')
      ? ` (tracking: ${str(data, 'trackingId')})`
      : '',
    trackingNumber: str(data, 'trackingNumber'),
    reportType: str(data, 'reportType'),
    rowCount: str(data, 'rowCount'),
    ticketNumber: str(data, 'ticketNumber'),
    subject: str(data, 'subject'),
    reportNumber: str(data, 'reportNumber'),
    title: str(data, 'title'),
    amountInr: str(data, 'amountInr'),
    reasonMessage: str(data, 'reasonMessage'),
    slaDays: str(data, 'slaDays', '5–7'),
  });
}

function defaultCta(type: NotificationType, data: EmailTemplateData): { label?: string; url?: string } {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  switch (type) {
    case 'EMAIL_VERIFICATION':
      return {
        label: EMAIL_COPY.ctaVerifyEmail,
        url: str(data, 'actionUrl', `${base}/verify-email`),
      };
    case 'PASSWORD_RESET':
      return {
        label: EMAIL_COPY.ctaResetPassword,
        url: str(data, 'actionUrl', `${base}/reset-password`),
      };
    case 'LOGIN_OTP':
      return { label: 'Enter sign-in code', url: str(data, 'actionUrl', `${base}/otp`) };
    case 'ORDER_CONFIRMATION':
    case 'PAYMENT_RECEIPT':
    case 'PAYMENT_FAILED':
    case 'ORDER_CANCELLED':
    case 'ORDER_RETURNED':
    case 'REFUND_PROCESSED':
    case 'REFUND_INITIATED':
    case 'SUBORDER_SHIPPED':
    case 'SUBORDER_DELIVERED':
      return {
        label: EMAIL_COPY.ctaViewOrder,
        url: str(data, 'actionUrl', `${base}/account/orders`),
      };
    case 'REVIEW_REQUEST':
      return {
        label: EMAIL_COPY.ctaLeaveReview,
        url: str(data, 'actionUrl', `${base}/account/orders`),
      };
    case 'ABANDONED_CART':
      return { label: EMAIL_COPY.ctaViewCart, url: str(data, 'actionUrl', `${base}/cart`) };
    case 'WALLET_RECHARGE_FAILED':
      return { label: 'View wallet', url: str(data, 'actionUrl', `${base}/account/wallet`) };
    case 'VENDOR_APPROVED':
    case 'VENDOR_NEW_ORDER':
    case 'LOW_STOCK_ALERT':
    case 'PAYOUT_PROCESSED':
    case 'PAYOUT_PAID':
    case 'PAYOUT_FAILED':
    case 'PRODUCT_APPROVED':
    case 'PRODUCT_REJECTED':
    case 'COUPON_USAGE_LIMIT':
    case 'COUPON_EXPIRING':
      return {
        label: EMAIL_COPY.ctaVendorDashboard,
        url: str(data, 'actionUrl', `${base}/vendor/dashboard`),
      };
    case 'COUPON_OFFER_EXPIRING':
      return { label: EMAIL_COPY.ctaViewCart, url: str(data, 'actionUrl', `${base}/cart`) };
    case 'TICKET_CREATED':
    case 'TICKET_REPLIED':
    case 'TICKET_RESOLVED':
    case 'TICKET_REOPENED': {
      const ticketId = str(data, 'ticketId', '');
      const portalGroupRaw = str(data, 'portalGroup', 'customer');
      const portalGroup =
        portalGroupRaw === 'admin' || portalGroupRaw === 'vendor' ? portalGroupRaw : 'customer';
      return {
        label: EMAIL_COPY.ctaViewTicket,
        url: str(data, 'actionUrl', ticketPortalUrlForGroup(ticketId, portalGroup)),
      };
    }
    case 'BUG_REPORT_TRIAGED':
    case 'BUG_REPORT_FIXED':
    case 'BUG_REPORT_WONT_FIX':
    case 'BUG_REPORT_DUPLICATE': {
      // Prefer caller actionUrl. If missing, use role-aware portal when reporterRole is present;
      // otherwise a neutral support path (do not assume customer vs vendor incorrectly).
      const bugReportId = str(data, 'bugReportId', '');
      const reporterRole = str(data, 'reporterRole', '');
      const fallback =
        bugReportId && reporterRole
          ? bugReportPortalUrl(bugReportId, reporterRole)
          : `${base}/support/bug-reports/${bugReportId}`;
      return {
        label: EMAIL_COPY.ctaViewBugReport,
        url: str(data, 'actionUrl', fallback),
      };
    }
    case 'DELIVERY_ASSIGNED':
    case 'PICKUP_ASSIGNED':
      return { label: 'Open delivery dashboard', url: str(data, 'actionUrl', `${base}/delivery/dashboard/today`) };
    case 'DELIVERY_OTP':
    case 'RETURN_PICKUP_OTP':
      return { label: EMAIL_COPY.ctaViewOrder, url: str(data, 'actionUrl', `${base}/orders`) };
    case 'RTO_HANDOVER_OTP':
      return { label: EMAIL_COPY.ctaVendorDashboard, url: str(data, 'actionUrl', `${base}/vendor/dashboard`) };
    case 'DELIVERY_ATTEMPT_FAILED':
      return { label: EMAIL_COPY.ctaTrackShipment, url: str(data, 'actionUrl', `${base}/orders/tracking`) };
    case 'PICKUP_ATTEMPT_FAILED':
      return { label: 'View return', url: str(data, 'actionUrl', `${base}/my-returns`) };
    default:
      return { label: EMAIL_COPY.ctaOpenStore, url: base };
  }
}

const MARKETING_TYPES = new Set<NotificationType>([
  'REVIEW_REQUEST',
  'ABANDONED_CART',
  'PRICE_DROP_ALERT',
  'BACK_IN_STOCK',
  'COUPON_OFFER_EXPIRING',
]);

export function isMarketingNotification(type: NotificationType): boolean {
  return MARKETING_TYPES.has(type);
}

export function renderNotificationEmail(
  type: NotificationType,
  data: EmailTemplateData,
): RenderedEmail {
  const subject = subjectFor(type, data);
  const greetingLine = greeting(data);
  const body = bodyFor(type, data);
  const cta = defaultCta(type, data);
  const bodyHtml = `<p>${escapeHtml(greetingLine)}</p><p>${escapeHtml(body)}</p>`;
  const rendered = renderEmailLayout({
    preview: body,
    title: subject,
    bodyHtml,
    ctaLabel: cta.label,
    ctaUrl: cta.url,
    footerNote: isMarketingNotification(type)
      ? EMAIL_COPY.footerUnsubscribe
      : EMAIL_COPY.footerHelp,
  });
  return { subject, ...rendered };
}
