import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { ValidationError } from '@core/errors/ValidationError';

const PURPOSE = 'marketing-unsubscribe';
export const UNSUBSCRIBE_LINK_INVALID = 'This unsubscribe link is not valid. Turn marketing emails off in your account settings instead.';

/** A link-safe token that names the user; it does not expire, as unsubscribe links must keep working. */
export function signUnsubscribeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: PURPOSE }, env.JWT_SECRET);
}

/** The page a person lands on from the footer link, and the one-click URL mail apps call. */
export function unsubscribeLinks(userId: string): { pageUrl: string; oneClickUrl: string } {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  const token = encodeURIComponent(signUnsubscribeToken(userId));
  return {
    pageUrl: `${base}/unsubscribe?token=${token}`,
    oneClickUrl: `${base}/api/notifications/unsubscribe?token=${token}`,
  };
}

/** RFC 8058 headers, so Gmail and others show their own Unsubscribe button. */
export function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/** Turns marketing emails off for the user the token names. */
export async function unsubscribeByToken(token: string): Promise<{ unsubscribed: true }> {
  let userId: string;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string; purpose?: string };
    if (decoded.purpose !== PURPOSE || !decoded.sub) throw new Error('purpose');
    userId = decoded.sub;
  } catch {
    throw new ValidationError({ token: [UNSUBSCRIBE_LINK_INVALID] });
  }
  await User.update({ emailMarketingConsent: false }, { where: { id: userId } });
  return { unsubscribed: true };
}
