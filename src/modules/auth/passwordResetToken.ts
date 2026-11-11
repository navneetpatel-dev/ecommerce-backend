import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { PASSWORD_RESET_EXPIRY } from '@core/constants/http';
import { ValidationError } from '@core/errors';

const PURPOSE = 'password-reset';
export const RESET_LINK_USED = 'This reset link has already been used. Request a new one.';
export const RESET_LINK_INVALID = 'Invalid or expired reset token';

/**
 * A short fingerprint of the password the link was issued for. Once the password
 * changes — by this link, change-password or an admin — every earlier link stops
 * working, so a used or forwarded link cannot set the password again.
 */
function passwordFingerprint(passwordHash: string | null | undefined): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(passwordHash ?? '')
    .digest('base64url')
    .slice(0, 22);
}

export function signPasswordResetToken(user: { id: string; passwordHash: string | null }): string {
  return jwt.sign({ sub: user.id, purpose: PURPOSE, pwd: passwordFingerprint(user.passwordHash) }, env.JWT_SECRET, {
    expiresIn: PASSWORD_RESET_EXPIRY,
  });
}

/** Returns the user id the token names; throws a field error on `token` otherwise. */
export function readPasswordResetToken(token: string): { userId: string; fingerprint: string | undefined } {
  let decoded: { sub: string; purpose: string; pwd?: string };
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as typeof decoded;
  } catch {
    throw new ValidationError({ token: [RESET_LINK_INVALID] });
  }
  if (decoded.purpose !== PURPOSE) {
    throw new ValidationError({ token: ['Invalid token purpose'] });
  }
  return { userId: decoded.sub, fingerprint: decoded.pwd };
}

/** Throws unless the token was issued for the password the account has now. */
export function assertResetTokenCurrent(fingerprint: string | undefined, passwordHash: string | null): void {
  if (fingerprint !== passwordFingerprint(passwordHash)) {
    throw new ValidationError({ token: [RESET_LINK_USED] });
  }
}
