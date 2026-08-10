import { Worker } from 'bullmq';
import { areQueuesReady, getQueueConnection, queues } from '@config/queue';
import { logger } from '@core/logger';
import { runS3OrphanCleanup, S3_ORPHAN_CLEANUP_JOB } from './s3OrphanCleanup';

const REPEAT_JOB_ID = 's3-orphan-cleanup-daily';

export function startS3OrphanCleanupWorker(): Worker {
  const worker = new Worker(
    's3-orphan-cleanup',
    async (job) => {
      if (job.name !== S3_ORPHAN_CLEANUP_JOB) return;
      const dryRun = Boolean(job.data?.dryRun);
      await runS3OrphanCleanup({ dryRun });
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error('S3 orphan cleanup job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export async function scheduleS3OrphanCleanupJob(): Promise<void> {
  if (!areQueuesReady()) return;

  await queues.s3OrphanCleanup.add(
    S3_ORPHAN_CLEANUP_JOB,
    {},
    {
      jobId: REPEAT_JOB_ID,
      repeat: { pattern: '0 3 * * *' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  logger.info('S3 orphan cleanup scheduled', { cron: '0 3 * * *' });
}

export async function stopS3OrphanCleanupWorker(worker: Worker | null): Promise<void> {
  if (worker) await worker.close();
}
