import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '@config/env';
import type { NotificationType } from '@database/models/notificationLog.model';
import { renderNotificationEmail } from '../templates/registry';

const TYPES: NotificationType[] = [
  'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'LOGIN_OTP', 'WELCOME', 'ORDER_CONFIRMATION', 'VENDOR_NEW_ORDER',
  'PAYMENT_RECEIPT', 'PAYMENT_FAILED', 'SUBORDER_SHIPPED', 'SUBORDER_DELIVERED', 'SUBORDER_CANCELLED',
  'REVIEW_REQUEST', 'ORDER_CANCELLED', 'ORDER_RETURNED', 'REFUND_PROCESSED', 'REFUND_INITIATED',
  'WALLET_RECHARGE_FAILED', 'VENDOR_APPLICATION_RECEIVED', 'VENDOR_APPROVED', 'VENDOR_REJECTED',
  'VENDOR_SUSPENDED', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'KYC_DOCUMENT_REJECTED', 'LOW_STOCK_ALERT',
  'PAYOUT_PROCESSED', 'PAYOUT_FAILED', 'PAYOUT_PAID', 'ABANDONED_CART', 'PRICE_DROP_ALERT', 'BACK_IN_STOCK',
  'ADMIN_NEW_VENDOR_PENDING', 'COUPON_USAGE_LIMIT', 'COUPON_EXPIRING', 'COUPON_OFFER_EXPIRING',
  'TICKET_CREATED', 'TICKET_REPLIED', 'TICKET_RESOLVED', 'TICKET_REOPENED', 'BUG_REPORT_TRIAGED',
  'BUG_REPORT_FIXED', 'BUG_REPORT_WONT_FIX', 'BUG_REPORT_DUPLICATE', 'DELIVERY_ATTEMPT_FAILED', 'ADMIN_BROADCAST',
];

// Pages that exist in ecommerce-web (src/app). Keep in step with the web routes.
const WEB_ROUTES = [
  /^\/$/, /^\/orders$/, /^\/orders\/[^/]+$/, /^\/orders\/tracking$/, /^\/cart$/, /^\/wallet$/, /^\/otp$/,
  /^\/reset-password$/, /^\/verify-email$/, /^\/login$/, /^\/products\/[^/]+$/, /^\/support\/tickets\/[^/]+$/,
  /^\/support\/bug-reports\/[^/]+$/, /^\/vendor$/, /^\/vendor\/register$/,
  /^\/vendor\/dashboard\/(overview|orders|products|payouts|coupons|returns|reviews|profile)$/,
  /^\/vendor\/dashboard\/(support-tickets|bug-reports)\/[^/]+$/, /^\/admin(\/[a-z-]+)?$/, /^\/admin\/support-tickets\/[^/]+$/,
];

const SAMPLE = { orderId: 'o-123', orderNumber: 'O123', ticketId: 't-1', bugReportId: 'b-1', reporterRole: 'CUSTOMER', total: 499 };

describe('email buttons lead to real pages (B-30)', () => {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  for (const type of TYPES) {
    it(type, () => {
      const { html } = renderNotificationEmail(type, SAMPLE);
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        const url = href!.replace(/&amp;/g, '&');
        if (!url.startsWith(base)) continue;
        const path = new URL(url).pathname.replace(/\/$/, '') || '/';
        assert.ok(WEB_ROUTES.some((route) => route.test(path)), `${type} links to ${path}, which is not a page`);
      }
    });
  }

  it('sends order emails to that order', () => {
    const { html } = renderNotificationEmail('ORDER_CONFIRMATION', SAMPLE);
    assert.match(html, /\/orders\/o-123/);
  });
});
