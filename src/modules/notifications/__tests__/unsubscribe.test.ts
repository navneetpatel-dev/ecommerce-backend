import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { renderNotificationEmail } from '../templates/registry';
import { signUnsubscribeToken, unsubscribeByToken, unsubscribeHeaders, unsubscribeLinks } from '../unsubscribe';

describe('one-click unsubscribe on marketing email (B-54)', () => {
  afterEach(() => mock.restoreAll());

  it('puts an Unsubscribe link in marketing mail only', () => {
    const { pageUrl } = unsubscribeLinks('u1');
    const marketing = renderNotificationEmail('ABANDONED_CART', { unsubscribeUrl: pageUrl });
    assert.match(marketing.html, />Unsubscribe</);
    assert.match(marketing.text, /Unsubscribe: .*\/unsubscribe\?token=/);
    const transactional = renderNotificationEmail('ORDER_CONFIRMATION', { unsubscribeUrl: pageUrl, orderNumber: 'X' });
    assert.doesNotMatch(transactional.html, />Unsubscribe</);
  });

  it('sends the RFC 8058 headers mail apps use for their own button', () => {
    const { oneClickUrl } = unsubscribeLinks('u1');
    assert.deepEqual(unsubscribeHeaders(oneClickUrl), {
      'List-Unsubscribe': `<${oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('turns marketing off for the user the link names, and refuses other tokens', async () => {
    const update = mock.method(User, 'update', async () => [1] as never);
    await unsubscribeByToken(signUnsubscribeToken('u1'));
    assert.deepEqual(update.mock.calls[0]!.arguments[0], { emailMarketingConsent: false });
    assert.deepEqual((update.mock.calls[0]!.arguments[1] as { where: unknown }).where, { id: 'u1' });
    const resetToken = jwt.sign({ sub: 'u1', purpose: 'password-reset' }, env.JWT_SECRET);
    await assert.rejects(unsubscribeByToken(resetToken), { statusCode: 422 });
    await assert.rejects(unsubscribeByToken('nonsense'), { statusCode: 422 });
  });
});
