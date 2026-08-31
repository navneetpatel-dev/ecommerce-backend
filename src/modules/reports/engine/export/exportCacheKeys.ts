export const STATUS_CACHE_PREFIX = 'report-export:status:';
export const PRESIGNED_CACHE_PREFIX = 'report-export:presigned:';

export function statusCacheKey(exportId: string): string {
  return `${STATUS_CACHE_PREFIX}${exportId}`;
}

export function presignedCacheKey(exportId: string): string {
  return `${PRESIGNED_CACHE_PREFIX}${exportId}`;
}
