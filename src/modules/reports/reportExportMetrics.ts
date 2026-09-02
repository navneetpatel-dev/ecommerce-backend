import { logger } from '@core/logger';

export type ReportExportMetricLabels = {
  reportType: string;
  format: string;
  rowCount?: number;
  durationMs?: number;
  byteSize?: number;
  outcome: 'completed' | 'failed';
};

/** Structured log lines — Prometheus-ready via log scraper. */
export function emitReportExportMetric(labels: ReportExportMetricLabels): void {
  logger.info('report_export_metric', {
    metric: `report_export_${labels.outcome}`,
    reportType: labels.reportType,
    format: labels.format,
    rowCount: labels.rowCount ?? null,
    durationMs: labels.durationMs ?? null,
    byteSize: labels.byteSize ?? null,
  });
}

export async function readScheduledReportQueueDepth(): Promise<{
  waiting: number;
  active: number;
  failed: number;
}> {
  try {
    const { queues, areQueuesReady } = await import('@config/queue');
    if (!areQueuesReady()) return { waiting: 0, active: 0, failed: 0 };
    const counts = await queues.reportExport.getJobCounts('waiting', 'active', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  } catch {
    return { waiting: 0, active: 0, failed: 0 };
  }
}
