import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { NewsletterSubscriber } from '@database/models/newsletterSubscriber.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { newsletterService, signNewsletterToken, NEWSLETTER_UNSUBSCRIBE_PURPOSE } from '../newsletter.service';

type Row = Record<string, any>;

function subscriber(fields: Row): Row {
  const row: Row = { id: 'sub-1', email: 'a@x.com', confirmedAt: null, unsubscribedAt: null, ...fields };
  row.update = mock.fn(async (patch: Row) => Object.assign(row, patch));
  return row;
}

describe('newsletterService (double opt-in)', () => {
  afterEach(() => mock.restoreAll());

  const captureEmails = () => {
    const sent: Row[] = [];
    mock.method(notificationsService, 'enqueue', async (params: Row) => {
      sent.push(params);
      return {} as never;
    });
    return sent;
  };

  it('emails a confirmation link to a new address and nothing else', async () => {
    const sent = captureEmails();
    mock.method(NewsletterSubscriber, 'findOrCreate', async () => [subscriber({}), true] as never);

    const result = await newsletterService.subscribe({ email: ' A@X.com ' });

    assert.equal(result.confirmationSent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.type, 'NEWSLETTER_CONFIRM');
    assert.equal(sent[0]!.to.email, 'a@x.com');
    assert.match(sent[0]!.templateData.actionUrl, /\/newsletter\/confirm\?token=/);
  });

  it('says so when the confirmation email could not be handed over (the signup is still saved)', async () => {
    mock.method(NewsletterSubscriber, 'findOrCreate', async () => [subscriber({}), true] as never);
    mock.method(notificationsService, 'enqueue', async () => null);

    const result = await newsletterService.subscribe({ email: 'a@x.com' });

    assert.equal(result.subscribed, true);
    assert.equal(result.confirmationSent, false);
  });

  it('does not email an already-confirmed subscriber again', async () => {
    const sent = captureEmails();
    mock.method(NewsletterSubscriber, 'findOrCreate', async () => [subscriber({ confirmedAt: new Date() }), false] as never);

    const result = await newsletterService.subscribe({ email: 'a@x.com' });

    assert.equal(result.alreadySubscribed, true);
    assert.equal(sent.length, 0);
  });

  it('confirms with a valid link, sends the welcome email once, and rejects a bad link', async () => {
    const sent = captureEmails();
    const row = subscriber({});
    mock.method(NewsletterSubscriber, 'findByPk', async () => row as never);
    const token = signNewsletterToken('sub-1', 'newsletter-confirm');

    await newsletterService.confirm(token);
    await newsletterService.confirm(token);

    assert.ok(row.confirmedAt);
    assert.equal(sent.filter((mail) => mail.type === 'NEWSLETTER_WELCOME').length, 1);
    assert.match(sent[0]!.templateData.unsubscribeUrl, /\/unsubscribe\?token=/);
    await assert.rejects(newsletterService.confirm('not-a-token-at-all'), /not valid/);
    await assert.rejects(newsletterService.confirm(signNewsletterToken('sub-1', 'something-else')), /not valid/);
  });

  it('unsubscribes with the permanent link and confirms by email', async () => {
    const sent = captureEmails();
    const row = subscriber({ confirmedAt: new Date() });
    mock.method(NewsletterSubscriber, 'findByPk', async () => row as never);

    await newsletterService.unsubscribe(signNewsletterToken('sub-1', NEWSLETTER_UNSUBSCRIBE_PURPOSE));

    assert.ok(row.unsubscribedAt);
    assert.equal(sent[0]!.type, 'NEWSLETTER_UNSUBSCRIBED');
  });

  it('asks a returning unsubscriber to confirm again', async () => {
    const sent = captureEmails();
    const row = subscriber({ confirmedAt: new Date(), unsubscribedAt: new Date() });
    mock.method(NewsletterSubscriber, 'findOrCreate', async () => [row, false] as never);

    await newsletterService.subscribe({ email: 'a@x.com' });

    assert.equal(row.unsubscribedAt, null);
    assert.equal(sent[0]!.type, 'NEWSLETTER_CONFIRM');
  });
});
