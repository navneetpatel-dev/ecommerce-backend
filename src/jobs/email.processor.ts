import { Worker, type Job } from 'bullmq';
import { logger } from '@core/logger';
import { env } from '@config/env';
import { getQueueConnection } from '@config/queue';
import { EMAIL_JOB_NAME, type EmailJobPayload } from '@modules/notifications/notifications.service';
import { deliverNotification } from '@modules/notifications/deliverEmail';

async function processEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  await deliverNotification({
    notificationLogId: job.data.notificationLogId,
    templateData: job.data.templateData,
    urgency: job.data.urgency,
    attachments: job.data.attachments,
  });
}

export function startEmailWorkers(): Worker[] {
  const connection = getQueueConnection();
  const workers: Worker[] = [];

  const transactional = new Worker<EmailJobPayload>(
    'email-transactional',
    processEmailJob,
    {
      connection,
      concurrency: env.EMAIL_TRANSACTIONAL_WORKER_CONCURRENCY,
      limiter: { max: env.MAIL_RATE_PER_MINUTE, duration: 60_000 },
    },
  );
  const marketing = new Worker<EmailJobPayload>(
    'email-marketing',
    processEmailJob,
    {
      connection,
      concurrency: env.EMAIL_MARKETING_WORKER_CONCURRENCY,
      limiter: { max: Math.max(1, Math.floor(env.MAIL_RATE_PER_MINUTE / 2)), duration: 60_000 },
    },
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
