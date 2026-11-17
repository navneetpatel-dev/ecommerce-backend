import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMAIL_COPY, formatEmailCopy } from '../emailCopy';
import { allEmailTypes, emailMeta } from '../templates/meta';
import { renderNotificationEmail } from '../templates/registry';
import { sampleEmailData } from '../templates/samples';

describe('email templates', () => {
  it('formats copy placeholders', () => {
    assert.equal(formatEmailCopy('Hello {name}', { name: 'Ada' }), 'Hello Ada');
  });

  it('renders order confirmation subject and html', () => {
    const rendered = renderNotificationEmail('ORDER_CONFIRMATION', {
      customerName: 'Ada',
      orderNumber: 'ABCDEF12',
      total: 499,
    });
    assert.match(rendered.subject, /ABCDEF12/);
    assert.match(rendered.html, /Ada/);
    assert.match(rendered.text, /Marketplace/);
  });

  it('every notification type has copy, a group, and renders with its sample data without holes', () => {
    const types = Object.keys(EMAIL_COPY.subjects);
    assert.deepEqual([...allEmailTypes()].sort(), types.sort(), 'every copy entry belongs to a preview group, and vice versa');
    for (const type of allEmailTypes()) {
      const rendered = renderNotificationEmail(type, sampleEmailData(type));
      assert.ok(emailMeta(type).group);
      assert.doesNotMatch(rendered.subject + rendered.text, /\{\w+\}|undefined|NaN/, `${type} has an unresolved value`);
      assert.doesNotMatch(rendered.text, /: \.|""|₹\s*[.,]|#\s|by \./, `${type} has a blank value: ${rendered.text.split('\n')[4]}`);
      assert.ok(!rendered.subject.startsWith('An update from'), `${type} fell back to generic wording`);
    }
  });

  it('uses generic wording instead of a sentence with a hole when data is missing', () => {
    const rendered = renderNotificationEmail('ORDER_CONFIRMATION', {});
    assert.doesNotMatch(rendered.text, /₹\./);
    assert.match(rendered.subject, /An update from Marketplace/);
  });

  it('passes every scalar the sender provides into the copy (answers, replies, who cancelled)', () => {
    assert.match(renderNotificationEmail('QUESTION_ANSWERED', { productName: 'Lamp', vendorName: 'DecorDen', answerText: 'Yes' }).text, /DecorDen: "Yes"/);
    assert.match(renderNotificationEmail('REVIEW_REPLIED', { productName: 'Lamp', vendorName: 'DecorDen', response: 'Thanks' }).text, /DecorDen has replied/);
    assert.match(renderNotificationEmail('VENDOR_ORDER_CANCELLED', { orderNumber: 'A1', cancelledBy: 'the customer' }).text, /cancelled by the customer/);
    assert.match(renderNotificationEmail('BUG_REPORT_DUPLICATE', { reportNumber: 'B1', title: 'T', duplicateOfReportNumber: 'B0' }).text, /duplicate of B0/);
  });

  it('is themed with the storefront palette and carries dark-mode rules', () => {
    const { html } = renderNotificationEmail('ORDER_CONFIRMATION', sampleEmailData('ORDER_CONFIRMATION'));
    assert.match(html, /#8a6a2e/i);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /#d9b25e/i);
    assert.match(html, /Marketplace/);
    assert.doesNotMatch(html, />Ecommerce</);
  });

  it('forces a theme for the admin preview', () => {
    const data = sampleEmailData('WELCOME');
    assert.doesNotMatch(renderNotificationEmail('WELCOME', data, { theme: 'light' }).html, /em-bg\{background/);
    assert.match(renderNotificationEmail('WELCOME', data, { theme: 'dark' }).html, /<style>\.em-bg\{background/);
  });

  it('renders items, totals and details sections from the data', () => {
    const { html, text } = renderNotificationEmail('ORDER_CONFIRMATION', sampleEmailData('ORDER_CONFIRMATION'));
    assert.match(html, /Audio Elite 10 Wireless Headphones/);
    assert.match(text, /Total paid: ₹4,417\.00/);
    assert.match(text, /Ship to: Karan Joshi/);
  });

  it('shows the sign-in code large, from just the code the sender passes', () => {
    const { html, text } = renderNotificationEmail('LOGIN_OTP', { code: '482916', expiresInMinutes: 10 });
    assert.match(html, /letter-spacing:6px[^>]*>482916</);
    assert.match(text, /482916\n\(Expires in 10 minutes/);
  });

  it('escapes user-supplied text', () => {
    const { html } = renderNotificationEmail('ADMIN_BROADCAST', { subject: 'Hi', message: '<script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>alert/);
  });

  it('puts the unsubscribe link only on marketing mail and a security footer on account mail', () => {
    const marketing = renderNotificationEmail('ABANDONED_CART', { unsubscribeUrl: 'https://x.test/u' });
    assert.match(marketing.html, /https:\/\/x\.test\/u/);
    assert.match(renderNotificationEmail('PASSWORD_CHANGED', {}).text, /secure your account/i);
    assert.doesNotMatch(renderNotificationEmail('ORDER_CONFIRMATION', { unsubscribeUrl: 'https://x.test/u', orderNumber: 'A', total: 1 }).html, /x\.test\/u/);
  });
});
