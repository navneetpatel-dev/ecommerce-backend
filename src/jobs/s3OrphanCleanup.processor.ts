import { Worker } from 'bullmq';
import { areQueuesReady, getQueueConnection, queues } from '@config/queue';
import { logger } from '@core/logger';
import { runS3OrphanCleanup, S3_ORPHAN_CLEANUP_JOB } from './s3OrphanCleanup';
import {
  REPORT_EXPORT_CLEANUP_JOB,
  runReportExportCleanup,
} from './reportExportCleanup.processor';
import {
  WALLET_RECHARGE_EXPIRY_JOB,
  runWalletRechargeExpiry,
} from './walletRechargeExpiry.processor';
import { REFUND_RETRY_JOB, runRefundRetry } from './refundRetry.processor';
import { PROMO_POINTS_EXPIRY_JOB, runPromoPointsExpiry } from './promoPointsExpiry.processor';

const REPEAT_JOB_ID = 's3-orphan-cleanup-daily';
const EXPORT_CLEANUP_JOB_ID = 'report-export-cleanup-daily';
const WALLET_RECHARGE_EXPIRY_JOB_ID = 'wallet-recharge-expiry-hourly';
const REFUND_RETRY_JOB_ID = 'refund-retry-hourly';
const PROMO_POINTS_EXPIRY_JOB_ID = 'promo-points-expiry-daily';

export function startS3OrphanCleanupWorker(): Worker {
  const worker = new Worker(
    's3-orphan-cleanup',
    async (job) => {
      if (job.name === S3_ORPHAN_CLEANUP_JOB) {
        const dryRun = Boolean(job.data?.dryRun);
        await runS3OrphanCleanup({ dryRun });
        return;
      }
      if (job.name === REPORT_EXPORT_CLEANUP_JOB) {
        await runReportExportCleanup();
        return;
      }
      if (job.name === WALLET_RECHARGE_EXPIRY_JOB) {
        await runWalletRechargeExpiry();
        return;
      }
      if (job.name === REFUND_RETRY_JOB) {
        await runRefundRetry();
        return;
      }
      if (job.name === PROMO_POINTS_EXPIRY_JOB) {
        await runPromoPointsExpiry();
        return;
      }
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error('Background job failed', {
      jobName: job?.name,
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

  await queues.s3OrphanCleanup.add(
    REPORT_EXPORT_CLEANUP_JOB,
    {},
    {
      jobId: EXPORT_CLEANUP_JOB_ID,
      repeat: { pattern: '15 3 * * *' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Report export cleanup scheduled', { cron: '15 3 * * *' });

  await queues.s3OrphanCleanup.add(
    WALLET_RECHARGE_EXPIRY_JOB,
    {},
    {
      jobId: WALLET_RECHARGE_EXPIRY_JOB_ID,
      repeat: { pattern: '0 * * * *' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Wallet recharge expiry scheduled', { cron: '0 * * * *' });

  await queues.s3OrphanCleanup.add(
    REFUND_RETRY_JOB,
    {},
    {
      jobId: REFUND_RETRY_JOB_ID,
      repeat: { pattern: '30 * * * *' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Refund retry scheduled', { cron: '30 * * * *' });

  await queues.s3OrphanCleanup.add(
    PROMO_POINTS_EXPIRY_JOB,
    {},
    {
      jobId: PROMO_POINTS_EXPIRY_JOB_ID,
      repeat: { pattern: '45 3 * * *' },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info('Promo points expiry scheduled', { cron: '45 3 * * *' });
}

export async function stopS3OrphanCleanupWorker(worker: Worker | null): Promise<void> {
  if (worker) await worker.close();
}
