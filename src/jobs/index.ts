import type { Worker } from 'bullmq';
import { areQueuesReady } from '@config/queue';
import { logger } from '@core/logger';
import { startEmailWorkers, stopEmailWorkers } from './email.processor';
import { startNotificationScheduler, stopNotificationScheduler } from './notificationScheduler';
import { startProductAffinityScheduler, stopProductAffinityScheduler } from './productAffinity.processor';
import { startReportExportWorker, stopReportExportWorker } from './reportExport.processor';
import {
  scheduleS3OrphanCleanupJob,
  startS3OrphanCleanupWorker,
  stopS3OrphanCleanupWorker,
} from './s3OrphanCleanup.processor';
import { scheduleWeeklyReportsJob } from './scheduledReports.processor';

let emailWorkers: Worker[] = [];
let reportExportWorker: Worker | null = null;
let s3OrphanCleanupWorker: Worker | null = null;
let workersStarted = false;

export async function startBackgroundWorkers(): Promise<void> {
  if (workersStarted) return;

  emailWorkers = startEmailWorkers();
  s3OrphanCleanupWorker = startS3OrphanCleanupWorker();
  await scheduleS3OrphanCleanupJob();

  if (areQueuesReady()) {
    await scheduleWeeklyReportsJob();
    reportExportWorker = startReportExportWorker();
  }

  startNotificationScheduler();
  startProductAffinityScheduler();
  workersStarted = true;
  logger.info('Background workers ready');
}

export async function stopBackgroundWorkers(): Promise<void> {
  stopNotificationScheduler();
  stopProductAffinityScheduler();
  await stopEmailWorkers(emailWorkers);
  await stopReportExportWorker(reportExportWorker);
  await stopS3OrphanCleanupWorker(s3OrphanCleanupWorker);
  emailWorkers = [];
  reportExportWorker = null;
  s3OrphanCleanupWorker = null;
  workersStarted = false;
}
