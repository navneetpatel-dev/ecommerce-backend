import { Op } from 'sequelize';
import { NotificationLog, type NotificationType } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { AppError } from '@core/errors/AppError';
import {
  areQueuesReady,
  queues,
  DEFAULT_MARKETING_JOB_OPTIONS,
  DEFAULT_TRANSACTIONAL_JOB_OPTIONS,
} from '@config/queue';
import { isMarketingNotification, type EmailTemplateData } from './templates/registry';
import { EMAIL_COPY } from './emailCopy';
import { pushService } from './push.service';

export const EMAIL_JOB_NAME = 'notification-delivery';

/** Documents an email can carry; the worker builds them at send time so they are always current. */
export type EmailAttachmentSpec =
  | { kind: 'taxInvoice'; subOrderId: string }
  | { kind: 'commissionInvoice'; invoiceId: string }
  | { kind: 'payoutStatement'; payoutId: string };

export type EmailJobPayload = {
  notificationLogId: string;
  type: NotificationType;
  userId: string | null;
  /** Recipient address when there is no user account behind it. */
  recipientEmail?: string | null;
  referenceType: string;
  referenceId: string;
  templateData: EmailTemplateData;
  urgency: 'transactional' | 'marketing';
  attachments?: EmailAttachmentSpec[];
};

export type EnqueueParams = {
  /** A registered user. Leave out and pass `to` for someone without an account. */
  userId?: string | null;
  to?: { email: string; name?: string | null };
  type: NotificationType;
  referenceType: string;
  referenceId: string;
  templateData?: EmailTemplateData;
  attachments?: EmailAttachmentSpec[];
  actorId?: string | null;
  /** Force queue choice; defaults from type. */
  urgency?: 'transactional' | 'marketing';
  /**
   * For flows where the email is the whole point (sign-in code, verification, password
   * reset): if it cannot be handed to the mail queue, throw `EmailUnavailableError` so the
   * user is told instead of waiting for mail that is not coming. Everything else is safe:
   * a failure is logged and never reaches the caller.
   */
  strict?: boolean;
};

type Recipient = { userId: string | null; email: string; name: string | null; blocksMarketing: boolean };

async function resolveRecipient(params: EnqueueParams, urgency: 'transactional' | 'marketing'): Promise<Recipient | null> {
  if (params.userId) {
    const user = await User.findByPk(params.userId, {
      attributes: ['id', 'email', 'name', 'emailMarketingConsent', 'emailSuppressed', 'status'],
    });
    if (!user?.email) {
      logger.warn('Skip notification — user email missing', { userId: params.userId, type: params.type });
      return null;
    }
    if (urgency === 'marketing' && (!user.emailMarketingConsent || user.emailSuppressed)) {
      logger.info('Skip marketing notification — no consent or suppressed', { userId: params.userId, type: params.type });
      return null;
    }
    return { userId: user.id, email: user.email, name: user.name, blocksMarketing: false };
  }
  const email = params.to?.email?.trim().toLowerCase();
  if (!email) {
    logger.warn('Skip notification — no recipient', { type: params.type });
    return null;
  }
  return { userId: null, email, name: params.to?.name ?? null, blocksMarketing: false };
}

/** Where an email goes in the queue system, shared by first sends and sweeper retries. */
export async function addEmailJob(payload: EmailJobPayload, attempt = 0): Promise<boolean> {
  if (!areQueuesReady()) {
    logger.warn('Queues unavailable — notification left PENDING for the sweeper', {
      notificationLogId: payload.notificationLogId,
      type: payload.type,
    });
    return false;
  }
  const marketing = payload.urgency === 'marketing';
  const queue = marketing ? queues.emailMarketing : queues.emailTransactional;
  const options = marketing ? DEFAULT_MARKETING_JOB_OPTIONS : DEFAULT_TRANSACTIONAL_JOB_OPTIONS;
  try {
    await queue.add(EMAIL_JOB_NAME, payload, {
      ...options,
      // BullMQ rejects custom jobId values that contain `:`; the attempt keeps a retry from colliding with the first job.
      jobId: `${payload.type}-${payload.referenceId}-${payload.notificationLogId}${attempt ? `-r${attempt}` : ''}`.replace(/[:/]/g, '-'),
    });
    return true;
  } catch (error) {
    logger.error('Failed to enqueue email job', {
      notificationLogId: payload.notificationLogId,
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

/** Creates (or reuses) a PENDING NotificationLog, remembers what to send, and queues delivery. */
async function enqueueInternal(params: EnqueueParams): Promise<{ log: NotificationLog | null; queued: boolean }> {
  const urgency = params.urgency ?? (isMarketingNotification(params.type) ? 'marketing' : 'transactional');
  const recipient = await resolveRecipient(params, urgency);
  if (!recipient) return { log: null, queued: false };

  // One email per recipient, type and reference — and reference type, which a sender can use
  // to tell apart updates on one record (each status of a return gets its own email).
  const { type, referenceType, referenceId } = params;
  const dedupe = recipient.userId
    ? { userId: recipient.userId, type, referenceType, referenceId }
    : { userId: null, recipientEmail: recipient.email, type, referenceType, referenceId };
  const alreadySent = await NotificationLog.findOne({ where: { ...dedupe, status: NOTIFICATION_STATUS.SENT } });
  if (alreadySent) return { log: alreadySent, queued: true };

  const templateData: EmailTemplateData = {
    customerName: recipient.name,
    name: recipient.name,
    email: recipient.email,
    brand: EMAIL_COPY.brandName,
    ...(params.templateData ?? {}),
  };
  const payload = { templateData, urgency, attachments: params.attachments ?? [] };

  let log = await NotificationLog.findOne({
    where: { ...dedupe, status: { [Op.in]: [NOTIFICATION_STATUS.PENDING, NOTIFICATION_STATUS.FAILED] } },
    order: [['createdAt', 'DESC']],
  });
  if (!log) {
    log = await NotificationLog.create({
      userId: recipient.userId,
      recipientEmail: recipient.userId ? null : recipient.email,
      type,
      referenceType,
      referenceId,
      channel: 'EMAIL',
      status: NOTIFICATION_STATUS.PENDING,
      providerMessageId: null,
      payload,
      error: null,
      sentAt: null,
      createdBy: params.actorId ?? recipient.userId,
      updatedBy: null,
      deletedBy: null,
    });
  } else {
    await log.update({ status: NOTIFICATION_STATUS.PENDING, error: null, payload, updatedBy: params.actorId ?? recipient.userId });
  }

  const queued = await addEmailJob({
    notificationLogId: log.id,
    type,
    userId: recipient.userId,
    recipientEmail: recipient.userId ? null : recipient.email,
    referenceType,
    referenceId,
    templateData,
    urgency,
    attachments: params.attachments,
  });

  if (recipient.userId) {
    void pushService
      .sendForNotification({ userId: recipient.userId, type, referenceType, referenceId, templateData })
      .catch((error) => {
        logger.warn('Browser push dispatch failed', {
          userId: recipient.userId,
          type,
          error: error instanceof Error ? error.message : error,
        });
      });
  }
  return { log, queued };
}

/** The mail system could not take an email that the caller needs to be sent. */
export class EmailUnavailableError extends AppError {
  constructor() {
    super("We couldn't send the email right now. Please try again in a moment.", 503, 'EMAIL_UNAVAILABLE');
  }
}

/**
 * Creates (or reuses) a PENDING NotificationLog, remembers what to send, and queues delivery.
 * Never sends synchronously from the request path, and never throws: an email problem must not
 * fail the business action that triggered it. A failure is logged with its context and the
 * caller gets null. With `strict` it throws `EmailUnavailableError` instead (see EnqueueParams).
 */
export async function enqueueNotification(params: EnqueueParams): Promise<NotificationLog | null> {
  try {
    const { log, queued } = await enqueueInternal(params);
    if (params.strict && log && !queued) {
      // Do not leave it to be sent later: the user is being told it failed and will ask again.
      await log.update({ status: NOTIFICATION_STATUS.FAILED, errorCategory: 'CONFIG', error: 'The mail queue was unavailable' }).catch(() => undefined);
      throw new EmailUnavailableError();
    }
    return log;
  } catch (error) {
    if (error instanceof EmailUnavailableError) throw error;
    logger.error('Could not hand an email to the mail system', {
      type: params.type,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      userId: params.userId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    if (params.strict) throw new EmailUnavailableError();
    return null;
  }
}
