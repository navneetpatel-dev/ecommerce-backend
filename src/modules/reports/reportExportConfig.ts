import { env } from '@config/env';

export const reportExportConfig = {
  maxRangeDays: env.REPORT_MAX_RANGE_DAYS,
  workerConcurrency: env.REPORT_EXPORT_WORKER_CONCURRENCY,
  rateLimitPerMin: env.REPORT_EXPORT_RATE_LIMIT_PER_MIN,
  maxPendingPerUser: env.REPORT_EXPORT_MAX_PENDING_PER_USER,
  cacheTtlMin: env.REPORT_EXPORT_CACHE_TTL_MIN,
  artifactTtlDays: env.REPORT_EXPORT_ARTIFACT_TTL_DAYS,
  inlineDev: env.REPORT_EXPORT_INLINE_DEV,
  chunkSize: env.REPORT_EXPORT_CHUNK_SIZE,
  staleProcessingMin: env.REPORT_EXPORT_STALE_PROCESSING_MIN,
  pendingStaleMin: env.REPORT_EXPORT_PENDING_STALE_MIN,
  failedRetentionDays: env.REPORT_EXPORT_FAILED_RETENTION_DAYS,
  statusCacheTtlSec: 5,
  presignedExpiresSec: 15 * 60,
  userExportPriority: 1,
  scheduledExportPriority: 5,
  isProduction: env.NODE_ENV === 'production',
} as const;
