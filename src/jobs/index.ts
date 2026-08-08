import type { Worker } from 'bullmq';
import { logger } from '@core/logger';
import { startEmailWorkers, stopEmailWorkers } from './email.processor';
import { startNotificationScheduler, stopNotificationScheduler } from './notificationScheduler';
import { startReportExportWorker, stopReportExportWorker } from './reportExport.processor';

let emailWorkers: Worker[] = [];
let reportExportWorker: Worker | null = null;
let workersStarted = false;

export async function startBackgroundWorkers(): Promise<void> {
  if (workersStarted) return;
  emailWorkers = startEmailWorkers();
  reportExportWorker = startReportExportWorker();
  startNotificationScheduler();
  workersStarted = true;
  logger.info('Background workers ready');
}

export async function stopBackgroundWorkers(): Promise<void> {
  stopNotificationScheduler();
  await stopEmailWorkers(emailWorkers);
  await stopReportExportWorker(reportExportWorker);
  emailWorkers = [];
  reportExportWorker = null;
  workersStarted = false;
}
