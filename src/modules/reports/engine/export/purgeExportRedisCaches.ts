import { redisClient } from '@config/redis';
import { presignedCacheKey, statusCacheKey } from './exportCacheKeys';
import { invalidateArtifactCache } from './exportArtifactCache';

/** Drop status, presigned, and artifact probe cache for an export log. */
export async function purgeExportRedisCaches(exportId: string): Promise<void> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') await redisClient.connect();
    await redisClient.del(statusCacheKey(exportId), presignedCacheKey(exportId));
  } catch {
    /* optional */
  }
  await invalidateArtifactCache(exportId);
}
