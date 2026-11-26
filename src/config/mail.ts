import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';
import { env } from '@config/env';

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
  /** Extra MIME headers (List-Unsubscribe on marketing mail). */
  headers?: Record<string, string>;
};

export type MailSendResult = {
  messageId: string;
  provider: 'smtp';
};

/** Thrown when mail is sent while SMTP_HOST is not set. `code` lets the delivery log file it as a config problem. */
export class MailNotConfiguredError extends Error {
  readonly code = 'ESMTPNOTCONFIGURED';
  constructor() {
    super('SMTP is not configured (set SMTP_HOST, SMTP_USER and SMTP_PASS)');
    this.name = 'MailNotConfiguredError';
  }
}

export function formatMailFrom(message: MailMessage): string {
  const email = message.from ?? env.MAIL_FROM_EMAIL;
  const name = env.MAIL_FROM_NAME;
  return name ? `${name} <${email}>` : email;
}

type Transport = Pick<ReturnType<typeof nodemailer.createTransport>, 'sendMail'>;

function createSmtpTransport(): Transport | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // One reused, authenticated connection instead of a fresh login per email: Gmail
    // answers a login per message with "Too many login attempts".
    // A hung connection must not hold a worker (and every email behind it) for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    dnsTimeout: 10_000,
    socketTimeout: 30_000,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 60_000,
    rateLimit: env.MAIL_RATE_PER_MINUTE,
  });
}

let transport: Transport | null | undefined;

function getTransport(): Transport | null {
  if (transport === undefined) transport = createSmtpTransport();
  return transport;
}

/** Drops the cached SMTP connection so the next send builds a fresh one (tests, config reloads). */
export function resetMailTransport(): void {
  transport = undefined;
}

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST?.trim());
}

/** Sends one email over SMTP. */
export async function sendEmail(message: MailMessage): Promise<MailSendResult> {
  const smtp = getTransport();
  if (!smtp) throw new MailNotConfiguredError();

  const info = await smtp.sendMail({
    from: formatMailFrom(message),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        }
      : {}),
  });

  return { messageId: info.messageId || randomUUID(), provider: 'smtp' };
}
