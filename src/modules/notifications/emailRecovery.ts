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

export interface BulkResendParams {
  ids?: string[];
  referenceId?: string;
  type?: string;
  errorCategory?: string;
  includeStuckPending?: boolean;
}

export interface BulkResendResult {
  attempted: number;
  requeued: number;
  skipped: number;
  errors: string[];
}

export interface BulkResendPreview {
  totalEligible: number;
  failedCount: number;
  stuckPendingCount: number;
  skippedNoPayloadCount: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  sampleRows: Array<{
    id: string;
    type: string;
    recipient: string;
    status: string;
    errorCategory: string | null;
    error: string | null;
    attempts: number;
    createdAt: Date;
  }>;
}

function buildBulkResendWhere(params: BulkResendParams, includePayloadFilter: boolean) {
  const stuckCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const statusCondition = params.includeStuckPending
    ? {
        [Op.or]: [
          { status: NOTIFICATION_STATUS.FAILED },
          { status: NOTIFICATION_STATUS.PENDING, createdAt: { [Op.lt]: stuckCutoff } },
        ],
      }
    : { status: NOTIFICATION_STATUS.FAILED };

  const where: Record<string | symbol, unknown> = {
    ...statusCondition,
    ...(includePayloadFilter ? { payload: { [Op.ne]: null } } : {}),
  };
  if (params.ids?.length) where.id = { [Op.in]: params.ids };
  if (params.referenceId) where.referenceId = params.referenceId;
  if (params.type) where.type = params.type;
  if (params.errorCategory) where.errorCategory = params.errorCategory;
  return where;
}

export async function previewBulkResendNotifications(
  params: BulkResendParams = {},
): Promise<BulkResendPreview> {
  const eligibleWhere = buildBulkResendWhere(params, true);
  const noPayloadWhere = {
    ...buildBulkResendWhere(params, false),
    payload: null,
  };

  const [eligibleRows, skippedNoPayloadCount, sample] = await Promise.all([
    NotificationLog.findAll({
      where: eligibleWhere as Record<string, unknown>,
      attributes: ['id', 'status', 'errorCategory', 'type'],
      order: [['createdAt', 'DESC']],
      limit: 500,
      raw: true,
    }) as unknown as Array<{ id: string; status: string; errorCategory: string | null; type: string }>,
    NotificationLog.count({ where: noPayloadWhere as Record<string, unknown> }),
    NotificationLog.findAll({
      where: eligibleWhere as Record<string, unknown>,
      attributes: ['id', 'type', 'recipientEmail', 'status', 'errorCategory', 'error', 'attempts', 'createdAt'],
      include: [{ model: User, as: 'user', attributes: ['email'], required: false }],
      order: [['createdAt', 'DESC']],
      limit: 25,
      raw: true,
      nest: true,
    }) as unknown as Array<{
      id: string;
      type: string;
      recipientEmail: string | null;
      status: string;
      errorCategory: string | null;
      error: string | null;
      attempts: number;
      createdAt: Date;
      user?: { email?: string | null };
    }>,
  ]);

  let failedCount = 0;
  let stuckPendingCount = 0;
  const byCategory: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const row of eligibleRows) {
    if (row.status === NOTIFICATION_STATUS.FAILED) failedCount += 1;
    else stuckPendingCount += 1;
    const cat = row.errorCategory ?? (row.status === NOTIFICATION_STATUS.PENDING ? 'STUCK_PENDING' : 'UNCATEGORIZED');
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byType[row.type] = (byType[row.type] ?? 0) + 1;
  }

  return {
    totalEligible: eligibleRows.length,
    failedCount,
    stuckPendingCount,
    skippedNoPayloadCount,
    byCategory,
    byType,
    sampleRows: sample.map((r) => ({
      id: r.id,
      type: r.type,
      recipient: r.user?.email ?? r.recipientEmail ?? 'Unknown recipient',
      status: r.status,
      errorCategory: r.errorCategory,
      error: r.error,
      attempts: r.attempts ?? 0,
      createdAt: r.createdAt,
    })),
  };
}

export async function bulkResendNotifications(
  actorId: string,
  params: BulkResendParams = {},
): Promise<BulkResendResult> {
  const where = buildBulkResendWhere(params, true);

  const rows = await NotificationLog.findAll({
    where: where as Record<string, unknown>,
    attributes: ['id'],
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

  let requeued = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const settled = await Promise.allSettled(
      chunk.map((row) => resendNotification(row.id, actorId)),
    );
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        requeued += 1;
      } else {
        skipped += 1;
        if (errors.length < 10) {
          errors.push(res.reason instanceof Error ? res.reason.message : 'Resend failed');
        }
      }
    }
  }

  return { attempted: rows.length, requeued, skipped, errors };
}
