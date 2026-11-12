import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { EMAIL_VERIFY_EXPIRY } from '@core/constants/http';

/** The link in the verification email: a signed, time-limited token on /verify-email. */
export function emailVerifyActionUrl(userId: string): string {
  const verifyToken = jwt.sign({ sub: userId, purpose: 'email-verify' }, env.JWT_SECRET, { expiresIn: EMAIL_VERIFY_EXPIRY });
  return `${env.CLIENT_URL.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verifyToken)}`;
}
