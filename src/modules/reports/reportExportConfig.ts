import { env } from '@config/env';

export const reportExportConfig = {
  maxRangeDays: env.REPORT_MAX_RANGE_DAYS,
  workerConcurrency: env.REPORT_EXPORT_WORKER_CONCURRENCY,
  rateLimitPerMin: env.REPORT_EXPORT_RATE_LIMIT_PER_MIN,
  chunkSize: env.REPORT_EXPORT_CHUNK_SIZE,
  maxRows: env.REPORT_EXPORT_MAX_ROWS,
  isProduction: env.NODE_ENV === 'production',
} as const;
