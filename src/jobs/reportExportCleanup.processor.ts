import fs from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { ReportExportLog } from '@database/models/reportExportLog.model';
import { deleteObject, extractS3KeyFromUrl } from '@config/s3';
import { reportExportConfig } from '@modules/reports/reportExportConfig';

export const REPORT_EXPORT_CLEANUP_JOB = 'report-export-cleanup';

const LOCAL_EXPORT_DIR = path.join(process.cwd(), 'storage', 'report-exports');

export async function runReportExportCleanup(): Promise<{ deletedLogs: number; deletedKeys: number }> {
  const cutoff = new Date(Date.now() - reportExportConfig.artifactTtlDays * 24 * 60 * 60 * 1000);
  let deletedLogs = 0;
  let deletedKeys = 0;

  while (true) {
    const expired = await ReportExportLog.findAll({
      where: {
        status: 'READY',
        [Op.or]: [
          { expiresAt: { [Op.lt]: new Date() } },
          { expiresAt: null, exportedAt: { [Op.lt]: cutoff } },
        ],
      },
      limit: 500,
    });
    if (expired.length === 0) break;

    for (const log of expired) {
      if (log.fileUrl) {
        const key = extractS3KeyFromUrl(log.fileUrl);
        if (key) {
          await deleteObject(key);
          deletedKeys += 1;
        }
      } else if (log.fileKey) {
        await fs.unlink(path.join(LOCAL_EXPORT_DIR, log.fileKey)).catch(() => undefined);
        deletedKeys += 1;
      }
      await log.destroy();
      deletedLogs += 1;
    }

    if (expired.length < 500) break;
  }

  // Purge orphaned local files older than TTL
  try {
    const entries = await fs.readdir(LOCAL_EXPORT_DIR);
    for (const name of entries) {
      const full = path.join(LOCAL_EXPORT_DIR, name);
      const stat = await fs.stat(full);
      if (stat.mtime < cutoff) await fs.unlink(full).catch(() => undefined);
    }
  } catch {
    /* dir may not exist */
  }

  logger.info('Report export cleanup finished', { deletedLogs, deletedKeys });
  return { deletedLogs, deletedKeys };
}
