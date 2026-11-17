import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { enqueueNotification } from '../notificationDelivery';
import { sweepStaleEmails } from '../emailRecovery';

type Row = Record<string, any>;

function fakeLog(fields: Row): Row {
  const row: Row = { attempts: 0, ...fields };
  row.update = mock.fn(async (patch: Row) => Object.assign(row, patch));
  return row;
}

describe('enqueueNotification', () => {
  afterEach(() => mock.restoreAll());

  it('sends to an address with no account, remembering the recipient and the payload for a retry', async () => {
    mock.method(NotificationLog, 'findOne', async () => null);
    const created: Row[] = [];
    mock.method(NotificationLog, 'create', async (fields: Row) => {
      created.push(fields);
      return fakeLog({ id: 'log-1', ...fields }) as never;
    });

    const log = await enqueueNotification({
      to: { email: 'Asha@Example.com', name: 'Asha' },
      type: 'NEWSLETTER_CONFIRM',
      referenceType: 'NewsletterSubscriber',
      referenceId: 'sub-1',
      templateData: { actionUrl: 'https://x.test/confirm' },
    });

    assert.ok(log);
    assert.equal(created[0]!.userId, null);
    assert.equal(created[0]!.recipientEmail, 'asha@example.com');
    assert.equal(created[0]!.payload.templateData.actionUrl, 'https://x.test/confirm');
    assert.equal(created[0]!.payload.urgency, 'transactional');
  });

  it('skips marketing mail for a user who has not opted in', async () => {
    mock.method(User, 'findByPk', async () => ({ id: 'u1', email: 'a@x.com', name: 'A', emailMarketingConsent: false, emailSuppressed: false }) as never);
    const create = mock.method(NotificationLog, 'create', async () => fakeLog({}) as never);
    mock.method(NotificationLog, 'findOne', async () => null);

    assert.equal(await enqueueNotification({ userId: 'u1', type: 'WISHLIST_DIGEST', referenceType: 'W', referenceId: 'x' }), null);
    assert.equal(create.mock.callCount(), 0);
  });

  it('does nothing without a recipient', async () => {
    assert.equal(await enqueueNotification({ type: 'WELCOME', referenceType: 'U', referenceId: 'x' }), null);
  });

  it('returns the already-sent email instead of sending it twice', async () => {
    const sent = fakeLog({ id: 'old', status: 'SENT' });
    mock.method(User, 'findByPk', async () => ({ id: 'u1', email: 'a@x.com', name: 'A', emailMarketingConsent: true, emailSuppressed: false }) as never);
    mock.method(NotificationLog, 'findOne', async () => sent as never);
    const create = mock.method(NotificationLog, 'create', async () => fakeLog({}) as never);

    const log = await enqueueNotification({ userId: 'u1', type: 'WELCOME', referenceType: 'User', referenceId: 'u1' });

    assert.equal(log, sent);
    assert.equal(create.mock.callCount(), 0);
  });
});

describe('sweepStaleEmails', () => {
  afterEach(() => mock.restoreAll());

  const payload = { templateData: {}, urgency: 'transactional' as const };
  const now = new Date('2026-11-18T12:00:00Z');

  it('closes out emails older than a day instead of sending them late', async () => {
    const update = mock.method(NotificationLog, 'update', async () => [3] as never);
    mock.method(NotificationLog, 'findAll', async () => [] as never);

    const result = await sweepStaleEmails(now);

    assert.equal(result.expired, 3);
    const [patch, options] = update.mock.calls[0]!.arguments as [Row, { where: Row }];
    assert.equal(patch.status, 'FAILED');
    assert.equal(options.where.status, 'PENDING');
  });

  it('counts an attempt on a stuck email and puts it back in flight', async () => {
    mock.method(NotificationLog, 'update', async () => [0] as never);
    const stuck = fakeLog({ id: 'a', status: 'PENDING', type: 'ORDER_CONFIRMATION', userId: 'u1', recipientEmail: null, referenceType: 'Order', referenceId: 'o1', payload });
    mock.method(NotificationLog, 'findAll', async () => [stuck] as never);

    await sweepStaleEmails(now);

    assert.equal(stuck.attempts, 1);
    assert.equal(stuck.status, 'PENDING');
  });

  it('retries a transient mail-server failure but not a permanent one', async () => {
    mock.method(NotificationLog, 'update', async () => [0] as never);
    const throttled = fakeLog({ id: 'a', status: 'FAILED', error: 'Invalid login: 454-4.7.0 Too many login attempts', type: 'WELCOME', userId: 'u1', recipientEmail: null, referenceType: 'User', referenceId: 'u1', payload });
    const bounced = fakeLog({ id: 'b', status: 'FAILED', error: 'Recipient email missing', type: 'WELCOME', userId: 'u2', recipientEmail: null, referenceType: 'User', referenceId: 'u2', payload });
    mock.method(NotificationLog, 'findAll', async () => [throttled, bounced] as never);

    await sweepStaleEmails(now);

    assert.equal(throttled.attempts, 1, 'the Gmail throttle is retried');
    assert.equal(bounced.attempts, 0, 'a permanent failure is left alone');
    assert.equal(bounced.status, 'FAILED');
  });
});
