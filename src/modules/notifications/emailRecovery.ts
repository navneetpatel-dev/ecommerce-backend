import { Op } from 'sequelize';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { clearSuppression } from './emailSuppression';
import { addEmailJob, EmailUnavailableError, type EmailAttachmentSpec } from './notificationDelivery';
import type { EmailTemplateData } from './templates/registry';

/** Rows older than this are given up on instead of sent late (an order email a day later is noise). */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_SWEEP_ATTEMPTS = 5;
const TRANSIENT_ERROR = /too many login|etimedout|econnreset|econnrefused|esocket|timeout|temporar|rate|try again|421|450|451|452|454/i;

/**
 * Recovers emails that never left: rows still PENDING (the queue was down when they were
 * created) and rows that failed on a transient mail-server error such as Gmail's login
 * throttle. Each is queued again up to a few times; anything older than a day is closed
 * out rather than sent late.
 */
export async function sweepStaleEmails(now: Date = new Date()): Promise<{ requeued: number; expired: number }> {
  const stale = new Date(now.getTime() - 3 * 60 * 1000);
  const transientRetryAfter = new Date(now.getTime() - 15 * 60 * 1000);
  const horizon = new Date(now.getTime() - STALE_AFTER_MS);

  const [expired] = await NotificationLog.update(
    { status: NOTIFICATION_STATUS.FAILED, error: 'Expired before it could be delivered' },
    { where: { status: NOTIFICATION_STATUS.PENDING, createdAt: { [Op.lt]: horizon } } },
  );

  const candidates = await NotificationLog.findAll({
    where: {
      payload: { [Op.ne]: null },
      attempts: { [Op.lt]: MAX_SWEEP_ATTEMPTS },
      createdAt: { [Op.gte]: horizon },
      [Op.or]: [
        { status: NOTIFICATION_STATUS.PENDING, updatedAt: { [Op.lt]: stale } },
        { status: NOTIFICATION_STATUS.FAILED, errorCategory: { [Op.or]: [null, 'TEMPORARY'] }, updatedAt: { [Op.lt]: transientRetryAfter } },
      ],
    },
    order: [['createdAt', 'ASC']],
    limit: 50,
  });

  let requeued = 0;
  for (const log of candidates) {
    // Rows from before failures were categorised are judged by their message.
    if (log.status === NOTIFICATION_STATUS.FAILED && !log.errorCategory && !TRANSIENT_ERROR.test(log.error ?? '')) continue;
    const saved = log.payload as { templateData?: EmailTemplateData; urgency?: 'transactional' | 'marketing'; attachments?: EmailAttachmentSpec[] };
    const attempt = log.attempts + 1;
    await log.update({ status: NOTIFICATION_STATUS.PENDING, error: null, errorCategory: null, sendingAt: null, attempts: attempt });
    const queued = await addEmailJob(
      {
        notificationLogId: log.id,
        type: log.type,
        userId: log.userId,
        recipientEmail: log.recipientEmail,
        referenceType: log.referenceType,
        referenceId: log.referenceId,
        templateData: saved.templateData ?? {},
        urgency: saved.urgency ?? 'transactional',
        attachments: saved.attachments,
      },
      attempt,
    );
    if (queued) requeued += 1;
  }
  return { requeued, expired };
}

/**
 * An admin re-queues one failed (or stuck) email from the log. It is sent again exactly as it
 * was first built. If it failed because the address bounced, the address is cleared first: the
 * admin is saying "try anyway".
 */
export async function resendNotification(logId: string, actorId: string): Promise<NotificationLog> {
  const log = await NotificationLog.findByPk(logId);
  if (!log) throw new NotFoundError('Notification');
  if (log.status === NOTIFICATION_STATUS.SENT) throw new ValidationError({ status: ['This email was already delivered'] });
  if (!log.payload) throw new ValidationError({ status: ['This email has nothing saved to resend (it predates resending)'] });

  const saved = log.payload as { templateData?: EmailTemplateData; urgency?: 'transactional' | 'marketing'; attachments?: EmailAttachmentSpec[] };
  const address = log.recipientEmail ?? (log.userId ? (await User.findByPk(log.userId, { attributes: ['email'] }))?.email : null);
  if (address) await clearSuppression(address);

  const attempt = log.attempts + 1;
  await log.update({ status: NOTIFICATION_STATUS.PENDING, error: null, errorCategory: null, sendingAt: null, attempts: attempt, updatedBy: actorId });
  const queued = await addEmailJob(
    {
      notificationLogId: log.id,
      type: log.type,
      userId: log.userId,
      recipientEmail: log.recipientEmail,
      referenceType: log.referenceType,
      referenceId: log.referenceId,
      templateData: saved.templateData ?? {},
      urgency: saved.urgency ?? 'transactional',
      attachments: saved.attachments,
    },
    attempt,
  );
  if (!queued) throw new EmailUnavailableError();
  return log;
}
