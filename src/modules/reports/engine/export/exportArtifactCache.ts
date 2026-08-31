import { redisClient } from '@config/redis';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  extractS3KeyFromUrl,
  isS3Configured,
  objectExists,
} from '@config/s3';
import type { ReportExportLog } from '@database/models/reportExportLog.model';

const ARTIFACT_CACHE_PREFIX = 'report-export:artifact:';
const ARTIFACT_CACHE_TTL_SEC = 300;
const LOCAL_EXPORT_DIR = path.join(process.cwd(), 'storage', 'report-exports');

async function readArtifactCache(exportId: string): Promise<boolean | null> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') await redisClient.connect();
    const raw = await redisClient.get(`${ARTIFACT_CACHE_PREFIX}${exportId}`);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

async function writeArtifactCache(exportId: string, exists: boolean): Promise<void> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') await redisClient.connect();
    await redisClient.setex(
      `${ARTIFACT_CACHE_PREFIX}${exportId}`,
      ARTIFACT_CACHE_TTL_SEC,
      exists ? '1' : '0',
    );
  } catch {
    /* optional */
  }
}

export async function markArtifactPresent(exportId: string): Promise<void> {
  await writeArtifactCache(exportId, true);
}

export async function invalidateArtifactCache(exportId: string): Promise<void> {
  try {
    if (redisClient.status === 'wait' || redisClient.status === 'end') await redisClient.connect();
    await redisClient.del(`${ARTIFACT_CACHE_PREFIX}${exportId}`);
  } catch {
    /* optional */
  }
}

async function probeArtifact(log: ReportExportLog): Promise<boolean> {
  if (!log.fileKey) return false;
  if (isS3Configured()) {
    const s3Key = log.fileUrl ? extractS3KeyFromUrl(log.fileUrl) ?? log.fileKey : log.fileKey;
    return objectExists(s3Key);
  }
  try {
    await fsp.access(path.join(LOCAL_EXPORT_DIR, log.fileKey));
    return true;
  } catch {
    return false;
  }
}

/** Redis-backed S3/local artifact probe (TTL 5 min). */
export async function exportArtifactExists(log: ReportExportLog): Promise<boolean> {
  const cached = await readArtifactCache(log.id);
  if (cached != null) return cached;
  const exists = await probeArtifact(log);
  await writeArtifactCache(log.id, exists);
  return exists;
}
