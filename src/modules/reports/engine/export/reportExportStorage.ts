import path from 'node:path';
import fsp from 'node:fs/promises';
import { env } from '@config/env';
import { isS3Configured } from '@config/s3';
import { logger } from '@core/logger';

export type ReportExportStorageBackend = 'local' | 's3';

export const REPORT_EXPORT_LOCAL_DIR = path.join(process.cwd(), 'storage', 'report-exports');

function resolveStorageBackend(): ReportExportStorageBackend {
  const configured = env.REPORT_EXPORT_STORAGE;
  if (configured === 'local') return 'local';
  if (configured === 's3') {
    if (!isS3Configured()) {
      logger.warn(
        'REPORT_EXPORT_STORAGE=s3 but AWS S3 is not configured — falling back to local disk',
      );
      return 'local';
    }
    return 's3';
  }
  if (env.NODE_ENV === 'production' && isS3Configured()) return 's3';
  return 'local';
}

/** Active backend for new report export artifacts. */
export const reportExportStorageBackend = resolveStorageBackend();

logger.info('Report export storage configured', { backend: reportExportStorageBackend });

export function reportExportUsesS3(): boolean {
  return reportExportStorageBackend === 's3';
}

export function reportExportUsesLocal(): boolean {
  return !reportExportUsesS3();
}

/** True when a stored export log row references an S3 object (not local disk). */
export function isReportExportOnS3(log: {
  fileKey?: string | null;
  fileUrl?: string | null;
}): boolean {
  if (log.fileUrl) return true;
  if (!log.fileKey) return false;
  return log.fileKey.includes('/');
}

export async function readLocalReportExport(fileKey: string): Promise<Buffer> {
  return fsp.readFile(path.join(REPORT_EXPORT_LOCAL_DIR, fileKey));
}
