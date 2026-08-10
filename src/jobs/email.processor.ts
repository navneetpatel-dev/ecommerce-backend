import { Worker, type Job } from 'bullmq';
import { NotificationLog } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { getQueueConnection } from '@config/queue';
import { sendEmail } from '@config/mail';
import { EMAIL_JOB_NAME, type EmailJobPayload } from '@modules/notifications/notifications.service';
import {
  isMarketingNotification,
  renderNotificationEmail,
} from '@modules/notifications/templates/registry';

async function processEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  const { notificationLogId, type, userId, templateData, urgency } = job.data;

  const log = await NotificationLog.findByPk(notificationLogId);
  if (!log) {
    logger.warn('Email job missing NotificationLog', { notificationLogId, jobId: job.id });
    return;
  }

  if (log.status === NOTIFICATION_STATUS.SENT) {
    return;
  }

  const alreadySent = await NotificationLog.findOne({
    where: {
      type: log.type,
      referenceId: log.referenceId,
      status: NOTIFICATION_STATUS.SENT,
    },
  });
  if (alreadySent && alreadySent.id !== log.id) {
    await log.update({
      status: NOTIFICATION_STATUS.SENT,
      providerMessageId: alreadySent.providerMessageId,
      sentAt: alreadySent.sentAt,
      error: null,
    });
    return;
  }

  const user = await User.findByPk(userId, {
    attributes: ['id', 'email', 'name', 'emailMarketingConsent', 'emailSuppressed'],
  });
  if (!user?.email) {
    await log.update({
      status: NOTIFICATION_STATUS.FAILED,
      error: 'Recipient email missing',
    });
    return;
  }

  const marketing = urgency === 'marketing' || isMarketingNotification(type);
  if (marketing && (user.emailSuppressed || !user.emailMarketingConsent)) {
    await log.update({
      status: NOTIFICATION_STATUS.FAILED,
      error: 'Marketing send blocked by consent or suppression',
    });
    return;
  }

  try {
    const rendered = renderNotificationEmail(type, {
      ...templateData,
      customerName: templateData.customerName ?? user.name,
      name: templateData.name ?? user.name,
    });

    const result = await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    await log.update({
      status: NOTIFICATION_STATUS.SENT,
      providerMessageId: result.messageId,
      sentAt: new Date(),
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email send failed';
    await log.update({
      status: NOTIFICATION_STATUS.FAILED,
      error: message,
    });
    throw error;
  }
}

export function startEmailWorkers(): Worker[] {
  const connection = getQueueConnection();
  const workers: Worker[] = [];

  const transactional = new Worker<EmailJobPayload>(
    'email-transactional',
    processEmailJob,
    { connection, concurrency: 10 },
  );
  const marketing = new Worker<EmailJobPayload>(
    'email-marketing',
    processEmailJob,
    { connection, concurrency: 3 },
  );

  for (const worker of [transactional, marketing]) {
    worker.on('completed', (job) => {
      logger.debug('Email job completed', { queue: worker.name, jobId: job.id, name: job.name });
    });
    worker.on('failed', (job, err) => {
      logger.error('Email job failed', {
        queue: worker.name,
        jobId: job?.id,
        name: job?.name ?? EMAIL_JOB_NAME,
        error: err.message,
      });
    });
    workers.push(worker);
  }

  logger.info('Email workers started', {
    queues: ['email-transactional', 'email-marketing'],
  });

  return workers;
}

export async function stopEmailWorkers(workers: Worker[]): Promise<void> {
  await Promise.allSettled(workers.map((worker) => worker.close()));
}
