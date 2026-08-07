import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatEmailCopy } from '../emailCopy';
import { renderNotificationEmail } from '../templates/registry';

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
    assert.match(rendered.text, /Ecommerce/);
  });
});
