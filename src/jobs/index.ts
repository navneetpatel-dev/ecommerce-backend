import type { Worker } from 'bullmq';
import { logger } from '@core/logger';
import { startEmailWorkers, stopEmailWorkers } from './email.processor';
import { startNotificationScheduler, stopNotificationScheduler } from './notificationScheduler';

let emailWorkers: Worker[] = [];
let workersStarted = false;

export async function startBackgroundWorkers(): Promise<void> {
  if (workersStarted) return;
  emailWorkers = startEmailWorkers();
  startNotificationScheduler();
  workersStarted = true;
  logger.info('Background workers ready');
}

export async function stopBackgroundWorkers(): Promise<void> {
  stopNotificationScheduler();
  await stopEmailWorkers(emailWorkers);
  emailWorkers = [];
  workersStarted = false;
}
