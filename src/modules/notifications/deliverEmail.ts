import { UnrecoverableError } from 'bullmq';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { env } from '@config/env';
import { sendEmail, type MailMessage } from '@config/mail';
import { settingsService } from '@modules/settings/settings.service';
import { buildEmailAttachments } from './emailAttachments';
import { isAddressSuppressed, suppressAddress } from './emailSuppression';
import { classifyMailError, sanitizeMailError, type MailErrorCategory } from './mailErrors';
import type { EmailAttachmentSpec } from './notificationDelivery';
import { isReservedTestDomain } from './reservedDomains';
import { unsubscribeHeaders, unsubscribeLinks } from './unsubscribe';
import { isMarketingNotification, renderNotificationEmail, type EmailTemplateData } from './templates/registry';

export type DeliverJob = {
  notificationLogId: string;
  templateData?: EmailTemplateData;
  urgency?: 'transactional' | 'marketing';
  attachments?: EmailAttachmentSpec[];
};

export type DeliverDeps = { send: (message: MailMessage) => Promise<{ messageId: string }> };

/** A send that started this recently and never finished may still have been delivered. */
const IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fail(log: NotificationLog, category: MailErrorCategory, message: string): Promise<void> {
  await log.update({ status: NOTIFICATION_STATUS.FAILED, errorCategory: category, error: sanitizeMailError(message), sendingAt: null });
}

/** The email has gone out; the row must say so. Never throws: a resend would mail the customer twice. */
async function recordSent(log: NotificationLog, messageId: string): Promise<void> {
  const fields = { status: NOTIFICATION_STATUS.SENT, providerMessageId: messageId, sentAt: new Date(), error: null, errorCategory: null, sendingAt: null };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await log.update(fields);
      return;
    } catch (error) {
      if (attempt === 3) {
        logger.error('Email was sent but its log row could not be updated', { notificationLogId: log.id, messageId, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      await sleep(150 * attempt);
    }
  }
}

/**
 * Sends one queued email and records the outcome.
 *
 * Every failure ends in a categorised FAILED row with a clear reason. Failures that retrying
 * cannot fix (a bounced address, a refused login, a template error) throw
 * `UnrecoverableError`, so the queue does not burn its retries on them; temporary ones throw
 * normally and are retried. A successful send is never repeated.
 */
export async function deliverNotification(job: DeliverJob, deps: DeliverDeps = { send: sendEmail }): Promise<void> {
  const log = await NotificationLog.findByPk(job.notificationLogId);
  if (!log) {
    logger.warn('Email job missing NotificationLog', { notificationLogId: job.notificationLogId });
    return;
  }
  if (log.status === NOTIFICATION_STATUS.SENT) return;

  const { type, userId, referenceType, referenceId } = log;
  const saved = (log.payload ?? {}) as { templateData?: EmailTemplateData; urgency?: 'transactional' | 'marketing'; attachments?: EmailAttachmentSpec[] };
  const templateData = job.templateData ?? saved.templateData ?? {};
  const urgency = job.urgency ?? saved.urgency;
  const attachmentSpecs = job.attachments ?? saved.attachments;

  // The same email already went to this very recipient (a retry raced the first job).
  const alreadySent = await NotificationLog.findOne({
    where: { type, referenceType, referenceId, userId, recipientEmail: log.recipientEmail, status: NOTIFICATION_STATUS.SENT },
  });
  if (alreadySent && alreadySent.id !== log.id) {
    await log.update({ status: NOTIFICATION_STATUS.SENT, providerMessageId: alreadySent.providerMessageId, sentAt: alreadySent.sentAt, error: null, errorCategory: null });
    return;
  }

  // A previous attempt started sending and never reported back: the worker died mid-send, so
  // the email may already be in the customer's inbox. Do not guess; an admin can resend it.
  if (log.sendingAt && Date.now() - new Date(log.sendingAt).getTime() < IN_FLIGHT_WINDOW_MS) {
    await fail(log, 'UNCERTAIN', 'A previous attempt may have been delivered before the worker stopped; check and resend if needed');
    throw new UnrecoverableError('Possible duplicate send prevented');
  }

  const user = userId
    ? await User.findByPk(userId, { attributes: ['id', 'email', 'name', 'emailMarketingConsent', 'emailSuppressed'] })
    : null;
  const to = user?.email ?? log.recipientEmail;
  if (!to) {
    await fail(log, 'RECIPIENT', 'Recipient email missing');
    return;
  }
  if (!env.MAIL_ALLOW_TEST_DOMAINS && isReservedTestDomain(to)) {
    await fail(log, 'RECIPIENT', 'Not sent: the address is on a reserved test domain and can never be delivered');
    return;
  }
  if (await isAddressSuppressed(to)) {
    await fail(log, 'RECIPIENT', 'Not sent: this address recently bounced. Resend from the log to try it again');
    return;
  }
  const marketing = urgency === 'marketing' || isMarketingNotification(type);
  if (marketing && user && (user.emailSuppressed || !user.emailMarketingConsent)) {
    await fail(log, 'RECIPIENT', 'Marketing send blocked by consent or suppression');
    return;
  }

  // Building the message can fail on its own (a bad template or data). Retrying cannot help.
  let message: MailMessage;
  try {
    const unsubscribe = marketing && user ? unsubscribeLinks(user.id) : null;
    const settings = await settingsService.getPlatformSettings();
    const rendered = renderNotificationEmail(type, {
      supportEmail: settings.supportEmail,
      supportHours: settings.supportHours,
      ...templateData,
      customerName: templateData.customerName ?? user?.name,
      name: templateData.name ?? user?.name,
      ...(unsubscribe ? { unsubscribeUrl: unsubscribe.pageUrl } : {}),
    });
    const attachments = await buildEmailAttachments(attachmentSpecs);
    message = {
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(typeof templateData.replyTo === 'string' ? { replyTo: templateData.replyTo } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(unsubscribe ? { headers: unsubscribeHeaders(unsubscribe.oneClickUrl) } : {}),
    };
  } catch (error) {
    await fail(log, 'RENDER', `Could not build the email: ${sanitizeMailError(error)}`);
    throw new UnrecoverableError(sanitizeMailError(error));
  }

  await log.update({ sendingAt: new Date() });
  let messageId: string;
  try {
    messageId = (await deps.send(message)).messageId;
  } catch (error) {
    const info = classifyMailError(error);
    await fail(log, info.category, info.message);
    if (info.suppress) await suppressAddress(to, info.message).catch(() => undefined);
    logger.warn('Email delivery failed', { notificationLogId: log.id, type, category: info.category, retryable: info.retryable, error: info.message });
    if (!info.retryable) throw new UnrecoverableError(info.message);
    throw error;
  }
  await recordSent(log, messageId);
}
