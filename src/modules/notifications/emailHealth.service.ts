import { Op } from 'sequelize';
import { NotificationLog } from '@database/models/notificationLog.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { areQueuesReady } from '@config/queue';
import { isMailConfigured } from '@config/mail';

export type EmailHealthStatus = 'OK' | 'DEGRADED' | 'DOWN';

export type EmailHealth = {
  status: EmailHealthStatus;
  /** One sentence an admin can act on. */
  headline: string;
  windowMinutes: number;
  sent: number;
  failed: number;
  stuck: number;
  failuresByCategory: Record<string, number>;
  lastSentAt: string | null;
  lastFailure: { category: string | null; error: string | null; at: string } | null;
};

export const HEALTH_WINDOW_MINUTES = 30;
const STUCK_AFTER_MINUTES = 15;

type Inputs = {
  configured: boolean;
  queuesReady: boolean;
  sent: number;
  failed: number;
  stuck: number;
  lastFailureCategory: string | null;
};

/**
 * Pure rule for the admin banner:
 * - DOWN: the mail system is not set up or the queue is gone, or emails are failing and
 *   none has gone out for the whole window (a revoked Gmail password looks exactly like this).
 * - DEGRADED: a lot of failures among the attempts, or many emails stuck waiting.
 */
export function judgeEmailHealth(input: Inputs): { status: EmailHealthStatus; headline: string } {
  if (!input.configured) return { status: 'DOWN', headline: 'No mail provider is configured, so no email can be sent.' };
  if (!input.queuesReady) return { status: 'DOWN', headline: 'The mail queue is unavailable (Redis is down), so emails are waiting and will be sent when it is back.' };
  if (input.failed >= 3 && input.sent === 0) {
    const why = input.lastFailureCategory === 'CONFIG' ? 'the mail login was refused: check the SMTP username and app password' : 'the mail server is refusing or not answering';
    return { status: 'DOWN', headline: `Emails are failing and none has been delivered recently: ${why}.` };
  }
  const attempts = input.sent + input.failed;
  if (input.stuck >= 10) return { status: 'DEGRADED', headline: `${input.stuck} emails have been waiting more than ${STUCK_AFTER_MINUTES} minutes to send.` };
  if (attempts >= 5 && input.failed / attempts >= 0.3) return { status: 'DEGRADED', headline: `${input.failed} of the last ${attempts} emails failed.` };
  return { status: 'OK', headline: 'Email delivery is healthy.' };
}

/** How email delivery is doing right now, from the last half hour of the log. */
export async function getEmailHealth(now: Date = new Date()): Promise<EmailHealth> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_MINUTES * 60 * 1000);
  const [sent, failedRows, stuck, lastSent] = await Promise.all([
    NotificationLog.count({ where: { status: NOTIFICATION_STATUS.SENT, sentAt: { [Op.gte]: since } } }),
    NotificationLog.findAll({
      where: { status: NOTIFICATION_STATUS.FAILED, updatedAt: { [Op.gte]: since }, errorCategory: { [Op.or]: [null, { [Op.ne]: 'RECIPIENT' }] } },
      attributes: ['errorCategory', 'error', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
      limit: 500,
    }),
    NotificationLog.count({ where: { status: NOTIFICATION_STATUS.PENDING, createdAt: { [Op.lt]: new Date(now.getTime() - STUCK_AFTER_MINUTES * 60 * 1000) } } }),
    NotificationLog.findOne({ where: { status: NOTIFICATION_STATUS.SENT }, attributes: ['sentAt'], order: [['sentAt', 'DESC']] }),
  ]);

  // A bounced address is the recipient's problem, not a sign the mail system is unwell.
  const failuresByCategory: Record<string, number> = {};
  for (const row of failedRows) failuresByCategory[row.errorCategory ?? 'UNKNOWN'] = (failuresByCategory[row.errorCategory ?? 'UNKNOWN'] ?? 0) + 1;
  const last = failedRows[0];
  const verdict = judgeEmailHealth({
    configured: isMailConfigured(),
    queuesReady: areQueuesReady(),
    sent,
    failed: failedRows.length,
    stuck,
    lastFailureCategory: last?.errorCategory ?? null,
  });
  return {
    ...verdict,
    windowMinutes: HEALTH_WINDOW_MINUTES,
    sent,
    failed: failedRows.length,
    stuck,
    failuresByCategory,
    lastSentAt: lastSent?.sentAt ? new Date(lastSent.sentAt).toISOString() : null,
    lastFailure: last ? { category: last.errorCategory, error: last.error, at: new Date(last.updatedAt).toISOString() } : null,
  };
}
