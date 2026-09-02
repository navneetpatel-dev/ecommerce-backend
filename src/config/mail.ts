import { env } from '@config/env';
import {
  createConsoleMailProvider,
  createSesMailProvider,
  createSmtpMailProvider,
} from './mail.providers';

export type MailDriver = 'auto' | 'console' | 'ses' | 'smtp';

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  /** Provider-specific options (e.g. `{ configurationSet }` for SES). */
  meta?: Record<string, unknown>;
};

export type MailSendResult = {
  messageId: string;
  provider: string;
};

export interface MailProvider {
  readonly name: string;
  isReady(): boolean;
  send(message: MailMessage): Promise<MailSendResult>;
}

/**
 * Register new drivers here when adding another email system
 * (SendGrid, Postmark, Resend, …): implement MailProvider in mail.providers.ts,
 * add the factory below, and extend MAIL_DRIVER in env.ts.
 */
const providers: Record<Exclude<MailDriver, 'auto'>, () => MailProvider> = {
  console: createConsoleMailProvider,
  ses: createSesMailProvider,
  smtp: createSmtpMailProvider,
};

function resolveAutoDriver(): Exclude<MailDriver, 'auto'> {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return 'ses';
  if (env.SMTP_HOST?.trim()) return 'smtp';
  return 'console';
}

export function createMailProvider(driver: MailDriver = env.MAIL_DRIVER): MailProvider {
  const resolved = driver === 'auto' ? resolveAutoDriver() : driver;
  return providers[resolved]();
}

let cached: MailProvider | null = null;

function getMailProvider(): MailProvider {
  if (!cached) cached = createMailProvider();
  return cached;
}

export function isMailConfigured(): boolean {
  return getMailProvider().isReady();
}

/** Sends via the active MAIL_DRIVER. Callers stay provider-agnostic. */
export async function sendEmail(message: MailMessage): Promise<MailSendResult> {
  return getMailProvider().send(message);
}
