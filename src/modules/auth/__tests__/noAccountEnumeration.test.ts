import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { authRepository } from '../auth.repository';
import { authService } from '../auth.service';
import { otpService } from '../otp.service';
import { notificationsService } from '@modules/notifications/notifications.service';

const unverified = { id: 'u1', status: 'ACTIVE', emailVerified: false };
const verified = { id: 'u2', status: 'ACTIVE', emailVerified: true };

describe('sign-in code and resend do not reveal accounts (B-02)', () => {
  afterEach(() => mock.restoreAll());

  it('answers the same for unknown, blocked and unverified emails', async () => {
    const verify = mock.method(notificationsService, 'sendEmailVerification', async () => null as never);
    for (const user of [null, { ...verified, status: 'BLOCKED' }, unverified]) {
      mock.method(authRepository, 'findByEmail', async () => user as never);
      await assert.doesNotReject(otpService.requestLoginCode('someone@example.com'));
    }
    // The unverified account gets its verification link instead of a code.
    assert.equal(verify.mock.callCount(), 1);
  });

  it('resend verification gives one reply whether the account is unknown, verified or not', async () => {
    mock.method(notificationsService, 'sendEmailVerification', async () => null as never);
    const replies = [];
    for (const user of [null, verified, unverified]) {
      mock.method(authRepository, 'findByEmail', async () => user as never);
      replies.push(await authService.resendEmailVerificationByEmail('someone@example.com'));
    }
    assert.deepEqual(replies, [replies[0], replies[0], replies[0]]);
  });
});
