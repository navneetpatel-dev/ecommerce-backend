import { env } from '@config/env';
import { exportConfig } from '@core/export';

export const reportExportConfig = {
  maxRangeDays: env.REPORT_MAX_RANGE_DAYS,
  workerConcurrency: env.REPORT_EXPORT_WORKER_CONCURRENCY,
  rateLimitPerMin: env.REPORT_EXPORT_RATE_LIMIT_PER_MIN,
  chunkSize: exportConfig.chunkSize,
  maxRows: exportConfig.maxRows,
  isProduction: env.NODE_ENV === 'production',
} as const;
