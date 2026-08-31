import type { Worker } from 'bullmq';
import { areQueuesReady } from '@config/queue';
import { logger } from '@core/logger';
import { startEmailWorkers, stopEmailWorkers } from './email.processor';
import { startNotificationScheduler, stopNotificationScheduler } from './notificationScheduler';
import { startReportExportWorker, stopReportExportWorker } from './reportExport.processor';
import {
  scheduleS3OrphanCleanupJob,
  startS3OrphanCleanupWorker,
  stopS3OrphanCleanupWorker,
} from './s3OrphanCleanup.processor';
import { runReportExportCleanup } from './reportExportCleanup.processor';
import { scheduleWeeklyReportsJob } from './scheduledReports.processor';

let emailWorkers: Worker[] = [];
let reportExportWorker: Worker | null = null;
let s3OrphanCleanupWorker: Worker | null = null;
let workersStarted = false;

export async function startBackgroundWorkers(): Promise<void> {
  if (workersStarted) return;
  emailWorkers = startEmailWorkers();
  reportExportWorker = startReportExportWorker();
  s3OrphanCleanupWorker = startS3OrphanCleanupWorker();
  await scheduleS3OrphanCleanupJob();
  await scheduleWeeklyReportsJob();
  if (areQueuesReady()) {
    void runReportExportCleanup().catch((err) =>
      logger.warn('Report export cleanup on startup skipped', {
        error: err instanceof Error ? err.message : err,
      }),
    );
  }
  startNotificationScheduler();
  workersStarted = true;
  logger.info('Background workers ready');
}

export async function stopBackgroundWorkers(): Promise<void> {
  stopNotificationScheduler();
  await stopEmailWorkers(emailWorkers);
  await stopReportExportWorker(reportExportWorker);
  await stopS3OrphanCleanupWorker(s3OrphanCleanupWorker);
  emailWorkers = [];
  reportExportWorker = null;
  s3OrphanCleanupWorker = null;
  workersStarted = false;
}
