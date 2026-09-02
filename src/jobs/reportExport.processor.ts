import { Worker } from 'bullmq';
import { getQueueConnection } from '@config/queue';
import { logger } from '@core/logger';
import { reportExportConfig } from '@modules/reports/reportExportConfig';
import {
  SCHEDULED_REPORTS_JOB,
  runScheduledWeeklyReports,
} from './scheduledReports.processor';

export function startReportExportWorker(): Worker {
  const worker = new Worker(
    'report-export',
    async (job) => {
      if (job.name === SCHEDULED_REPORTS_JOB) {
        await runScheduledWeeklyReports();
        return;
      }
    },
    { connection: getQueueConnection(), concurrency: reportExportConfig.workerConcurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error('Scheduled report job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export async function stopReportExportWorker(worker: Worker | null): Promise<void> {
  if (worker) await worker.close();
}
