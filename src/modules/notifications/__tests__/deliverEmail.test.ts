import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { NotificationLog } from '@database/models/notificationLog.model';
import { EmailSuppression } from '@database/models/emailSuppression.model';
import { User } from '@database/models/user.model';
import { settingsService } from '@modules/settings/settings.service';
import { deliverNotification } from '../deliverEmail';

type Row = Record<string, any>;

function fakeLog(fields: Row = {}): Row {
  const row: Row = {
    id: 'log-1', status: 'PENDING', type: 'ORDER_CONFIRMATION', userId: 'u1', recipientEmail: null, referenceType: 'Order', referenceId: 'o1',
    sendingAt: null, payload: { templateData: { orderNumber: 'A1B2C3D4', total: 100 }, urgency: 'transactional' }, ...fields,
  };
  row.update = mock.fn(async (patch: Row) => Object.assign(row, patch));
  return row;
}

function arrange(log: Row, email = 'karan@gmail.com') {
  mock.method(NotificationLog, 'findByPk', async () => log as never);
  mock.method(NotificationLog, 'findOne', async () => null);
  mock.method(User, 'findByPk', async () => ({ id: 'u1', email, name: 'Karan', emailMarketingConsent: true, emailSuppressed: false }) as never);
  mock.method(EmailSuppression, 'findOne', async () => null);
  mock.method(settingsService, 'getPlatformSettings', async () => ({ supportEmail: 's@shop.com', supportHours: '9-5' }) as never);
}

const mailError = (fields: Row) => Object.assign(new Error(String(fields.message ?? 'smtp')), fields);

describe('deliverNotification', () => {
  afterEach(() => mock.restoreAll());

  it('sends the email and records it as sent', async () => {
    const log = fakeLog();
    arrange(log);
    const sent: Row[] = [];

    await deliverNotification({ notificationLogId: 'log-1' }, { send: async (m) => (sent.push(m), { messageId: '<id@x>' }) });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, 'karan@gmail.com');
    assert.equal(log.status, 'SENT');
    assert.equal(log.providerMessageId, '<id@x>');
    assert.equal(log.sendingAt, null);
  });

  it('does nothing for an email that is already sent', async () => {
    arrange(fakeLog({ status: 'SENT' }));
    let called = false;
    await deliverNotification({ notificationLogId: 'log-1' }, { send: async () => ((called = true), { messageId: 'x' }) });
    assert.equal(called, false);
  });

  it('records a temporary failure with its category and lets the queue retry', async () => {
    const log = fakeLog();
    arrange(log);
    await assert.rejects(
      deliverNotification({ notificationLogId: 'log-1' }, { send: async () => { throw mailError({ code: 'EAUTH', responseCode: 454, message: 'Too many login attempts, try again later' }); } }),
      /Too many login/,
    );
    assert.equal(log.status, 'FAILED');
    assert.equal(log.errorCategory, 'TEMPORARY');
    assert.equal(log.sendingAt, null, 'a known failure clears the in-flight marker so the retry can send');
  });

  it('gives up at once on a bounced address and stops mailing it', async () => {
    const log = fakeLog();
    arrange(log);
    const created: Row[] = [];
    mock.method(EmailSuppression, 'create', async (fields: Row) => (created.push(fields), {}) as never);

    await assert.rejects(
      deliverNotification({ notificationLogId: 'log-1' }, { send: async () => { throw mailError({ responseCode: 550, response: '550 5.1.1 user unknown' }); } }),
      (error: Error) => error.name === 'UnrecoverableError',
    );

    assert.equal(log.errorCategory, 'RECIPIENT');
    assert.equal(created[0]!.email, 'karan@gmail.com');
  });

  it('does not retry a refused login (a configuration problem)', async () => {
    const log = fakeLog();
    arrange(log);
    await assert.rejects(
      deliverNotification({ notificationLogId: 'log-1' }, { send: async () => { throw mailError({ code: 'EAUTH', responseCode: 535, message: 'Username and Password not accepted' }); } }),
      (error: Error) => error.name === 'UnrecoverableError',
    );
    assert.equal(log.errorCategory, 'CONFIG');
  });

  it('fails a message it cannot build without sending or retrying', async () => {
    const log = fakeLog();
    arrange(log);
    mock.method(settingsService, 'getPlatformSettings', async () => { throw new Error('settings unavailable'); });
    let called = false;

    await assert.rejects(
      deliverNotification({ notificationLogId: 'log-1' }, { send: async () => ((called = true), { messageId: 'x' }) }),
      (error: Error) => error.name === 'UnrecoverableError',
    );

    assert.equal(called, false);
    assert.equal(log.errorCategory, 'RENDER');
  });

  it('never resends an email that was delivered but could not be recorded', async () => {
    const log = fakeLog();
    arrange(log);
    let sends = 0;
    // The status write fails after the provider accepted the message.
    log.update = mock.fn(async (patch: Row) => {
      if (patch.status === 'SENT') throw new Error('database went away');
      return Object.assign(log, patch);
    });

    await deliverNotification({ notificationLogId: 'log-1' }, { send: async () => ((sends += 1), { messageId: 'm1' }) });

    assert.equal(sends, 1, 'one send, and the job completes instead of throwing into a retry');
  });

  it('does not guess when an earlier attempt may have been delivered before the worker died', async () => {
    const log = fakeLog({ sendingAt: new Date(Date.now() - 60_000) });
    arrange(log);
    let called = false;

    await assert.rejects(
      deliverNotification({ notificationLogId: 'log-1' }, { send: async () => ((called = true), { messageId: 'x' }) }),
      (error: Error) => error.name === 'UnrecoverableError',
    );

    assert.equal(called, false);
    assert.equal(log.errorCategory, 'UNCERTAIN');
  });

  it('skips addresses that bounced recently, test domains and a missing address', async () => {
    for (const scenario of ['suppressed', 'test-domain', 'missing'] as const) {
      const log = fakeLog();
      arrange(log, scenario === 'test-domain' ? 'a@example.com' : 'a@gmail.com');
      if (scenario === 'suppressed') mock.method(EmailSuppression, 'findOne', async () => ({ id: 's' }) as never);
      if (scenario === 'missing') mock.method(User, 'findByPk', async () => ({ id: 'u1', email: null }) as never);
      let called = false;

      await deliverNotification({ notificationLogId: 'log-1' }, { send: async () => ((called = true), { messageId: 'x' }) });

      assert.equal(called, false, scenario);
      assert.equal(log.status, 'FAILED', scenario);
      assert.equal(log.errorCategory, 'RECIPIENT', scenario);
      mock.restoreAll();
    }
  });
});
