import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import {
  RESET_LINK_USED,
  assertResetTokenCurrent,
  readPasswordResetToken,
  signPasswordResetToken,
} from '../passwordResetToken';

const tokenErrors = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { validationDetails?: { fieldErrors: Record<string, string[]> } }).validationDetails?.fieldErrors.token ?? [];
  }
  return null;
};

describe('password reset links (B-01)', () => {
  it('works once: a password change kills the link', () => {
    const token = signPasswordResetToken({ id: 'u1', passwordHash: '$2b$12$old' });
    const { userId, fingerprint } = readPasswordResetToken(token);
    assert.equal(userId, 'u1');
    assert.doesNotThrow(() => assertResetTokenCurrent(fingerprint, '$2b$12$old'));
    // After the reset (or change-password, or an admin set) the hash differs.
    assert.deepEqual(tokenErrors(() => assertResetTokenCurrent(fingerprint, '$2b$12$new')), [RESET_LINK_USED]);
  });

  it('covers accounts that had no password (Google sign-in)', () => {
    const { fingerprint } = readPasswordResetToken(signPasswordResetToken({ id: 'u2', passwordHash: null }));
    assert.doesNotThrow(() => assertResetTokenCurrent(fingerprint, null));
    assert.deepEqual(tokenErrors(() => assertResetTokenCurrent(fingerprint, '$2b$12$set')), [RESET_LINK_USED]);
  });

  it('refuses links issued before this change, other purposes and tampering', () => {
    const legacy = jwt.sign({ sub: 'u1', purpose: 'password-reset' }, env.JWT_SECRET, { expiresIn: '15m' });
    const { fingerprint } = readPasswordResetToken(legacy);
    assert.deepEqual(tokenErrors(() => assertResetTokenCurrent(fingerprint, '$2b$12$old')), [RESET_LINK_USED]);
    const verify = jwt.sign({ sub: 'u1', purpose: 'email-verify' }, env.JWT_SECRET);
    assert.deepEqual(tokenErrors(() => readPasswordResetToken(verify)), ['Invalid token purpose']);
    assert.deepEqual(tokenErrors(() => readPasswordResetToken(`${legacy}x`)), ['Invalid or expired reset token']);
  });
});
