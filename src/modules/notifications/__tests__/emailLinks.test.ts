import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '@config/env';
import type { NotificationType } from '@database/models/notificationLog.model';
import { allEmailTypes } from '../templates/meta';
import { renderNotificationEmail } from '../templates/registry';
import { sampleEmailData } from '../templates/samples';

const TYPES: NotificationType[] = allEmailTypes();

// Pages that exist in ecommerce-web (src/app). Keep in step with the web routes.
const WEB_ROUTES = [
  /^\/$/, /^\/orders$/, /^\/orders\/[^/]+$/, /^\/orders\/tracking$/, /^\/cart$/, /^\/wallet$/, /^\/otp$/,
  /^\/reset-password$/, /^\/verify-email$/, /^\/login$/, /^\/products\/[^/]+$/, /^\/support\/tickets\/[^/]+$/,
  /^\/support\/bug-reports\/[^/]+$/, /^\/vendor$/, /^\/vendor\/register$/,
  /^\/vendor\/dashboard\/(overview|orders|products|payouts|coupons|returns|reviews|profile|shop-settings|qna|analytics|team)$/,
  /^\/vendor\/dashboard\/(support-tickets|bug-reports)\/[^/]+$/, /^\/admin(\/[a-z-]+)?$/, /^\/admin\/support-tickets\/[^/]+$/,
  /^\/admin\/bug-reports\/[^/]+$/, /^\/products$/, /^\/my-returns(\/[^/]+)?$/, /^\/wishlist$/, /^\/wallet\/cashback$/,
  /^\/gift-cards(\/mine|\/redeem\/[^/]+)?$/, /^\/help$/, /^\/contact$/, /^\/forgot-password$/, /^\/newsletter\/confirm$/, /^\/unsubscribe$/,
];

const SAMPLE = { orderId: 'o-123', orderNumber: 'O123', ticketId: 't-1', bugReportId: 'b-1', reporterRole: 'CUSTOMER', total: 499 };

describe('email buttons lead to real pages (B-30)', () => {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  for (const type of TYPES) {
    it(type, () => {
      const { html } = renderNotificationEmail(type, { ...SAMPLE, ...sampleEmailData(type) });
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
