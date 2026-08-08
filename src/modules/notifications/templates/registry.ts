import type { NotificationType } from '@database/models/notificationLog.model';
import { env } from '@config/env';
import { EMAIL_COPY, formatEmailCopy } from '../emailCopy';
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
  return formatEmailCopy(EMAIL_COPY.subjects[type], {
    orderNumber: str(data, 'orderNumber', str(data, 'orderId', '')),
    productName: str(data, 'productName'),
    code: str(data, 'code'),
    brand: EMAIL_COPY.brandName,
    reportType: str(data, 'reportType'),
  });
}

function bodyFor(type: NotificationType, data: EmailTemplateData): string {
  return formatEmailCopy(EMAIL_COPY.bodies[type], {
    brand: EMAIL_COPY.brandName,
    orderNumber: str(data, 'orderNumber', str(data, 'orderId')),
    total: str(data, 'total'),
    subtotal: str(data, 'subtotal'),
    amount: str(data, 'amount'),
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
    reportType: str(data, 'reportType'),
    rowCount: str(data, 'rowCount'),
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
    case 'ORDER_CONFIRMATION':
    case 'PAYMENT_RECEIPT':
    case 'PAYMENT_FAILED':
    case 'ORDER_CANCELLED':
    case 'ORDER_RETURNED':
    case 'REFUND_PROCESSED':
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
    case 'VENDOR_APPROVED':
    case 'VENDOR_NEW_ORDER':
    case 'LOW_STOCK_ALERT':
    case 'PAYOUT_PROCESSED':
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
    case 'REPORT_EXPORT_READY':
      return {
        label: EMAIL_COPY.ctaDownloadReport,
        url: str(data, 'actionUrl', `${base}/admin/reports`),
      };
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
