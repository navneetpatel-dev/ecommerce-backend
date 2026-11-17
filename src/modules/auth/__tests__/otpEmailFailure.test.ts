import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { notificationsService } from '@modules/notifications/notifications.service';
import { EmailUnavailableError } from '@modules/notifications/notificationDelivery';
import { authRepository } from '../auth.repository';
import { otpCooldown } from '../otpCooldown';
import { otpService } from '../otp.service';

describe('requestLoginCode when the email cannot be sent', () => {
  afterEach(() => mock.restoreAll());

  function arrange(emailVerified = true) {
    mock.method(otpCooldown, 'claim', async () => true);
    const release = mock.method(otpCooldown, 'release', async () => undefined);
    mock.method(authRepository, 'findByEmail', async () => ({ id: 'u1', status: 'ACTIVE', emailVerified }) as never);
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(otpService, 'issueCodeForUser', async () => ({ id: 'otp-1', code: '123456' }) as never);
    return release;
  }

  it('tells the shopper honestly and gives the minute of cooldown back so they can retry at once', async () => {
    const release = arrange();
    mock.method(notificationsService, 'sendLoginOtp', async () => { throw new EmailUnavailableError(); });

    await assert.rejects(otpService.requestLoginCode('a@gmail.com'), (error: unknown) => error instanceof EmailUnavailableError);

    assert.equal(release.mock.callCount(), 1);
  });

  it('asks for the code strictly, so a queue problem is reported', async () => {
    arrange();
    const send = mock.method(notificationsService, 'sendLoginOtp', async () => ({}) as never);

    await otpService.requestLoginCode('a@gmail.com');

    assert.deepEqual(send.mock.calls[0]!.arguments[3], { strict: true });
  });

  it('does the same for an unverified account, whose verification link is the email', async () => {
    const release = arrange(false);
    mock.method(notificationsService, 'sendEmailVerification', async () => { throw new EmailUnavailableError(); });

    await assert.rejects(otpService.requestLoginCode('a@gmail.com'), EmailUnavailableError);

    assert.equal(release.mock.callCount(), 1);
  });

  it('says nothing for an unknown address (no account to reveal)', async () => {
    mock.method(otpCooldown, 'claim', async () => true);
    mock.method(authRepository, 'findByEmail', async () => null);
    const send = mock.method(notificationsService, 'sendLoginOtp', async () => ({}) as never);

    await otpService.requestLoginCode('nobody@gmail.com');

    assert.equal(send.mock.callCount(), 0);
  });
});
