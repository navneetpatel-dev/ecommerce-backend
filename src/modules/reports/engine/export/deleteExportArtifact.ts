import fs from 'node:fs/promises';
import path from 'node:path';
import { deleteObject, extractS3KeyFromUrl } from '@config/s3';
import type { ReportExportLog } from '@database/models/reportExportLog.model';
import { isReportExportOnS3, REPORT_EXPORT_LOCAL_DIR } from './reportExportStorage';

/** Best-effort removal of S3/local artifact for an export log row. */
export async function deleteExportArtifact(
  log: Pick<ReportExportLog, 'fileKey' | 'fileUrl'>,
): Promise<void> {
  if (isReportExportOnS3(log)) {
    if (log.fileUrl) {
      const key = extractS3KeyFromUrl(log.fileUrl);
      if (key) {
        await deleteObject(key).catch(() => undefined);
        return;
      }
    }
    if (log.fileKey) {
      await deleteObject(log.fileKey).catch(() => undefined);
    }
    return;
  }
  if (!log.fileKey) return;
  await fs.unlink(path.join(REPORT_EXPORT_LOCAL_DIR, log.fileKey)).catch(() => undefined);
}
