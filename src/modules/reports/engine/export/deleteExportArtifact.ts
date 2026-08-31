import fs from 'node:fs/promises';
import path from 'node:path';
import { deleteObject, extractS3KeyFromUrl, isS3Configured } from '@config/s3';
import type { ReportExportLog } from '@database/models/reportExportLog.model';

const LOCAL_EXPORT_DIR = path.join(process.cwd(), 'storage', 'report-exports');

/** Best-effort removal of S3/local artifact for an export log row. */
export async function deleteExportArtifact(log: Pick<ReportExportLog, 'fileKey' | 'fileUrl'>): Promise<void> {
  if (log.fileUrl) {
    const key = extractS3KeyFromUrl(log.fileUrl);
    if (key) {
      await deleteObject(key).catch(() => undefined);
      return;
    }
  }
  if (!log.fileKey) return;
  if (isS3Configured()) {
    await deleteObject(log.fileKey).catch(() => undefined);
    return;
  }
  await fs.unlink(path.join(LOCAL_EXPORT_DIR, log.fileKey)).catch(() => undefined);
}
