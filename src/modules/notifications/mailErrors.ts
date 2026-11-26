export type MailErrorCategory = 'TEMPORARY' | 'PERMANENT' | 'RENDER' | 'RECIPIENT' | 'CONFIG' | 'UNCERTAIN';

export type MailErrorInfo = {
  category: MailErrorCategory;
  /** Whether trying again can help. Permanent failures are not retried. */
  retryable: boolean;
  /** The address itself is bad (hard bounce): stop mailing it for a while. */
  suppress: boolean;
  /** What is stored on the log row for the admin: short, single line, never a stack. */
  message: string;
};

type MailLikeError = { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown };

const HARD_BOUNCE = /5\.1\.[0-3]|user unknown|unknown user|no such user|does not exist|mailbox (unavailable|not found|does not exist)|invalid (recipient|address|mailbox)|recipient (rejected|address rejected)|address rejected/i;
const LOGIN_THROTTLE = /too many login|too many (connections|messages)|try again later|rate limit|temporarily|daily (user )?sending limit|4\.7\.0|5\.4\.5/i;
const BAD_CREDENTIALS = /invalid login|username and password not accepted|bad credentials|authentication (failed|unsuccessful)|5\.7\.8|5\.7\.0/i;

/** One line, no control characters, at most 400 characters: safe to store and show an admin. */
export function sanitizeMailError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? 'Email send failed');
  return text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 400) || 'Email send failed';
}

/**
 * Sorts a mail-server error into what to do about it. Throttling, timeouts and 4xx replies
 * are temporary; a bounced address, a rejected message or a refused login will not fix
 * themselves, so they are not retried (a refused login is a configuration problem, an
 * admin has to fix it and resend).
 */
export function classifyMailError(error: unknown): MailErrorInfo {
  const err = (error ?? {}) as MailLikeError;
  const text = `${String(err.response ?? '')} ${String(err.message ?? '')}`;
  const message = sanitizeMailError(error);
  const code = typeof err.code === 'string' ? err.code : '';
  const responseCode = Number(err.responseCode);

  if (LOGIN_THROTTLE.test(text)) return { category: 'TEMPORARY', retryable: true, suppress: false, message };
  if (code === 'EAUTH' || code === 'ESMTPNOTCONFIGURED' || BAD_CREDENTIALS.test(text) || responseCode === 535 || responseCode === 534) {
    return { category: 'CONFIG', retryable: false, suppress: false, message };
  }
  if (HARD_BOUNCE.test(text) || (code === 'EENVELOPE' && responseCode >= 550 && responseCode <= 553)) {
    return { category: 'RECIPIENT', retryable: false, suppress: true, message };
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ETIMEOUT'].includes(code) || (responseCode >= 400 && responseCode < 500)) {
    return { category: 'TEMPORARY', retryable: true, suppress: false, message };
  }
  if (responseCode >= 500 && responseCode < 600) return { category: 'PERMANENT', retryable: false, suppress: false, message };
  // Unknown errors may be transient: try again rather than give up on a real customer's email.
  return { category: 'TEMPORARY', retryable: true, suppress: false, message };
}
