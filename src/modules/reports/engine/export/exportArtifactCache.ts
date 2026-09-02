import { redisClient, withRedis } from '@config/redis';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { extractS3KeyFromUrl, objectExists } from '@config/s3';
import type { ReportExportLog } from '@database/models/reportExportLog.model';
import {
  isReportExportOnS3,
  REPORT_EXPORT_LOCAL_DIR,
} from './reportExportStorage';

const ARTIFACT_CACHE_PREFIX = 'report-export:artifact:';
const ARTIFACT_CACHE_TTL_SEC = 300;

async function readArtifactCache(exportId: string): Promise<boolean | null> {
  const raw = await withRedis(() => redisClient.get(`${ARTIFACT_CACHE_PREFIX}${exportId}`));
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

async function writeArtifactCache(exportId: string, exists: boolean): Promise<void> {
  await withRedis(() =>
    redisClient.setex(
      `${ARTIFACT_CACHE_PREFIX}${exportId}`,
      ARTIFACT_CACHE_TTL_SEC,
      exists ? '1' : '0',
    ),
  );
}

export async function markArtifactPresent(exportId: string): Promise<void> {
  await writeArtifactCache(exportId, true);
}

export async function invalidateArtifactCache(exportId: string): Promise<void> {
  await withRedis(() => redisClient.del(`${ARTIFACT_CACHE_PREFIX}${exportId}`));
}

async function probeArtifact(log: ReportExportLog): Promise<boolean> {
  if (!log.fileKey) return false;
  if (isReportExportOnS3(log)) {
    const s3Key = log.fileUrl ? extractS3KeyFromUrl(log.fileUrl) ?? log.fileKey : log.fileKey;
    return objectExists(s3Key);
  }
  try {
    await fsp.access(path.join(REPORT_EXPORT_LOCAL_DIR, log.fileKey));
    return true;
  } catch {
    return false;
  }
}

type ExportArtifactExistsOptions = {
  /** Bypass Redis so cache hits re-check storage before download. */
  forceProbe?: boolean;
};

/** Redis-backed S3/local artifact probe (TTL 5 min). */
export async function exportArtifactExists(
  log: ReportExportLog,
  options?: ExportArtifactExistsOptions,
): Promise<boolean> {
  if (!options?.forceProbe) {
    const cached = await readArtifactCache(log.id);
    if (cached != null) return cached;
  }
  const exists = await probeArtifact(log);
  await writeArtifactCache(log.id, exists);
  return exists;
}
