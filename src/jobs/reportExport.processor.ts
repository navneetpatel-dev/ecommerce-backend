import { Worker } from 'bullmq';
import { getQueueConnection } from '@config/queue';
import { logger } from '@core/logger';
import { reportEngine, REPORT_EXPORT_JOB } from '@modules/reports/engine/reportEngine';
import { reportExportConfig } from '@modules/reports/reportExportConfig';

export function startReportExportWorker(): Worker {
  const worker = new Worker(
    'report-export',
    async (job) => {
      if (job.name !== REPORT_EXPORT_JOB) return;
      const exportLogId = String((job.data as { exportLogId?: string }).exportLogId ?? '');
      if (!exportLogId) return;
      await reportEngine.processExportJob(exportLogId);
    },
    { connection: getQueueConnection(), concurrency: reportExportConfig.workerConcurrency },
  );

  worker.on('completed', () => {
    void import('@modules/reports/reportExportMetrics').then(({ emitReportExportQueueDepthMetric }) =>
      emitReportExportQueueDepthMetric(),
    );
  });

  worker.on('failed', (job, err) => {
    logger.error('Report export job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export async function stopReportExportWorker(worker: Worker | null): Promise<void> {
  if (worker) await worker.close();
}
