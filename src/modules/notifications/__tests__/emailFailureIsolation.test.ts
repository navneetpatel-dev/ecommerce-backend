import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';
import { NotificationLog } from '@database/models/notificationLog.model';
import { EmailSuppression } from '@database/models/emailSuppression.model';
import { User } from '@database/models/user.model';
import { notificationsService } from '../notifications.service';
import { EmailUnavailableError, enqueueNotification } from '../notificationDelivery';
import { resendNotification } from '../emailRecovery';
import { notifyPayoutPaid, notifyVendorNewQuestion } from '../events/vendorEvents';
import { notifyReviewApproved } from '../events/reviewEvents';
import { notifyWalletRecharged } from '../events/walletEvents';

type Row = Record<string, any>;

function fakeLog(fields: Row = {}): Row {
  const row: Row = { id: 'log-1', status: 'PENDING', attempts: 0, ...fields };
  row.update = mock.fn(async (patch: Row) => Object.assign(row, patch));
  return row;
}

const USER = { id: 'u1', email: 'a@gmail.com', name: 'A', emailMarketingConsent: true, emailSuppressed: false };

describe('a failed email never reaches the code that triggered it', () => {
  afterEach(() => mock.restoreAll());

  it('enqueue swallows a database failure and reports null (the business action carries on)', async () => {
    mock.method(User, 'findByPk', async () => { throw new Error('db down'); });
    assert.equal(await enqueueNotification({ userId: 'u1', type: 'ORDER_CONFIRMATION', referenceType: 'Order', referenceId: 'o1' }), null);
  });

  it('the typed senders used all over the app inherit that safety', async () => {
    mock.method(User, 'findByPk', async () => { throw new Error('db down'); });
    assert.equal(await notificationsService.sendOrderConfirmation('u1', 'o1', {}), null);
    assert.equal(await notificationsService.sendRefundProcessed('u1', 'r1', {}), null);
  });

  it('leaves a PENDING row for the sweeper when the queue is down, without failing', async () => {
    mock.method(User, 'findByPk', async () => USER as never);
    mock.method(NotificationLog, 'findOne', async () => null);
    const created = fakeLog();
    mock.method(NotificationLog, 'create', async () => created as never);

    const log = await enqueueNotification({ userId: 'u1', type: 'ORDER_CONFIRMATION', referenceType: 'Order', referenceId: 'o1' });

    assert.equal(log, created);
    assert.equal(created.status, 'PENDING');
  });

  it('strict mode tells the caller instead, and does not leave the email to arrive late', async () => {
    mock.method(User, 'findByPk', async () => USER as never);
    mock.method(NotificationLog, 'findOne', async () => null);
    const created = fakeLog();
    mock.method(NotificationLog, 'create', async () => created as never);

    await assert.rejects(
      enqueueNotification({ userId: 'u1', type: 'LOGIN_OTP', referenceType: 'OtpCode', referenceId: 'otp-1', strict: true }),
      (error: unknown) => error instanceof EmailUnavailableError && (error as EmailUnavailableError).statusCode === 503,
    );
    assert.equal(created.status, 'FAILED');
    assert.equal(created.errorCategory, 'CONFIG');

    mock.method(User, 'findByPk', async () => { throw new Error('db down'); });
    await assert.rejects(enqueueNotification({ userId: 'u1', type: 'LOGIN_OTP', referenceType: 'OtpCode', referenceId: 'otp-2', strict: true }), EmailUnavailableError);
  });

  it('event helpers resolve even when the email system throws', async () => {
    mock.method(notificationsService, 'enqueue', async () => { throw new Error('mail system exploded'); });
    mock.method(notificationsService, 'sendPayoutPaid', async () => { throw new Error('mail system exploded'); });
    // These look things up first; with nothing found they must still just return.
    mock.method(User, 'findOne', async () => { throw new Error('db down'); });
    await assert.doesNotReject(notifyVendorNewQuestion('q1'));
    await assert.doesNotReject(notifyReviewApproved('r1'));
    await assert.doesNotReject(notifyWalletRecharged('w1'));
    await assert.doesNotReject(notifyPayoutPaid({ id: 'p1', vendorId: 'v1', amount: 1 } as never));
  });
});

describe('resendNotification', () => {
  afterEach(() => mock.restoreAll());

  it('refuses an email that was already delivered, or one with nothing saved to send', async () => {
    mock.method(NotificationLog, 'findByPk', async () => fakeLog({ status: 'SENT', payload: {} }) as never);
    await assert.rejects(resendNotification('log-1', 'admin'), /already delivered/);
    mock.restoreAll();
    mock.method(NotificationLog, 'findByPk', async () => fakeLog({ status: 'FAILED', payload: null }) as never);
    await assert.rejects(resendNotification('log-1', 'admin'), /nothing saved/);
  });

  it('puts a failed email back in flight and clears a bounce so it is actually tried', async () => {
    const log = fakeLog({ status: 'FAILED', errorCategory: 'RECIPIENT', error: 'bounced', userId: 'u1', type: 'WELCOME', referenceType: 'User', referenceId: 'u1', payload: { templateData: {}, urgency: 'transactional' } });
    mock.method(NotificationLog, 'findByPk', async () => log as never);
    mock.method(User, 'findByPk', async () => USER as never);
    const cleared: string[] = [];
    mock.method(EmailSuppression, 'destroy', async (options: { where: { email: string } }) => (cleared.push(options.where.email), 1) as never);

    // Queues are not connected in tests, so the hand-off is refused, after the row was reset.
    await assert.rejects(resendNotification('log-1', 'admin'), EmailUnavailableError);

    assert.deepEqual(cleared, ['a@gmail.com']);
    assert.equal(log.attempts, 1);
    assert.equal(log.errorCategory, null);
  });
});

describe('guard: no email is sent from inside a transaction before it commits', () => {
  /** A send fired before commit mails the customer about something that may roll back. */
  it('every notification call made inside a transaction callback is wrapped in afterCommit', () => {
    const root = path.resolve(__dirname, '../../..');
    const offenders: string[] = [];
    const matchClose = (text: string, open: number) => {
      let depth = 0;
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        if (text[i] === ')' && --depth === 0) return i;
      }
      return text.length;
    };
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes(`${path.sep}notifications${path.sep}`)) {
          const text = fs.readFileSync(full, 'utf8');
          const spans = (pattern: RegExp) => [...text.matchAll(pattern)].map((m) => [m.index!, matchClose(text, text.indexOf('(', m.index!))] as const);
          const transactions = spans(/\w+\.transaction\(/g);
          const afterCommits = spans(/afterCommit\(/g);
          for (const call of text.matchAll(/notificationsService\.(send\w+|enqueue)\(/g)) {
            const at = call.index!;
            if (transactions.some(([a, b]) => a < at && at < b) && !afterCommits.some(([a, b]) => a < at && at < b)) {
              offenders.push(`${path.relative(root, full)}:${text.slice(0, at).split('\n').length}`);
            }
          }
        }
      }
    };
    walk(root);
    assert.deepEqual(offenders, []);
  });
});
