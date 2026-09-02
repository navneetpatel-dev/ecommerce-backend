import fs from 'node:fs/promises';
import path from 'node:path';
import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { ReportExportLog } from '@database/models/reportExportLog.model';
import { deleteObject, extractS3KeyFromUrl } from '@config/s3';
import { isReportExportOnS3, REPORT_EXPORT_LOCAL_DIR } from '@modules/reports/engine/export/reportExportStorage';
import { reportExportConfig } from '@modules/reports/reportExportConfig';
import { purgeExportRedisCaches } from '@modules/reports/engine/export/purgeExportRedisCaches';

export const REPORT_EXPORT_CLEANUP_JOB = 'report-export-cleanup';

const LOCAL_EXPORT_DIR = REPORT_EXPORT_LOCAL_DIR;

async function failStaleExports(
  where: Record<string, unknown>,
  errorMessage: string,
): Promise<number> {
  const stale = await ReportExportLog.findAll({ where, attributes: ['id'] });
  if (stale.length === 0) return 0;
  for (const log of stale) {
    await purgeExportRedisCaches(log.id);
  }
  const [count] = await ReportExportLog.update(
    { status: 'FAILED', errorMessage },
    { where },
  );
  return count;
}

export async function runReportExportCleanup(): Promise<{
  deletedLogs: number;
  deletedKeys: number;
  failedPending: number;
}> {
  const cutoff = new Date(Date.now() - reportExportConfig.artifactTtlDays * 24 * 60 * 60 * 1000);
  const pendingStaleCutoff = new Date(
    Date.now() - reportExportConfig.pendingStaleMin * 60 * 1000,
  );
  const failedCutoff = new Date(
    Date.now() - reportExportConfig.failedRetentionDays * 24 * 60 * 60 * 1000,
  );
  let deletedLogs = 0;
  let deletedKeys = 0;
  let failedPending = 0;

  failedPending += await failStaleExports(
    {
      status: 'PENDING',
      createdAt: { [Op.lt]: pendingStaleCutoff },
    },
    'Export enqueue timed out',
  );

  const processingStaleCutoff = new Date(
    Date.now() - reportExportConfig.staleProcessingMin * 60 * 1000,
  );
  failedPending += await failStaleExports(
    {
      status: 'PROCESSING',
      updatedAt: { [Op.lt]: processingStaleCutoff },
    },
    'Export processing timed out',
  );

  while (true) {
    const failedLogs = await ReportExportLog.findAll({
      where: {
        status: 'FAILED',
        updatedAt: { [Op.lt]: failedCutoff },
      },
      limit: 500,
    });
    if (failedLogs.length === 0) break;
    for (const log of failedLogs) {
      if (log.fileKey || log.fileUrl) {
        const { deleteExportArtifact } = await import(
          '@modules/reports/engine/export/deleteExportArtifact'
        );
        await deleteExportArtifact(log);
        deletedKeys += 1;
      }
      await purgeExportRedisCaches(log.id);
      await log.destroy();
      deletedLogs += 1;
    }
    if (failedLogs.length < 500) break;
  }

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
        if (isReportExportOnS3(log)) {
          await deleteObject(log.fileKey).catch(() => undefined);
          deletedKeys += 1;
        } else {
          await fs.unlink(path.join(LOCAL_EXPORT_DIR, log.fileKey)).catch(() => undefined);
          deletedKeys += 1;
        }
      }
      await purgeExportRedisCaches(log.id);
      await log.destroy();
      deletedLogs += 1;
    }

    if (expired.length < 500) break;
  }

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

  logger.info('Report export cleanup finished', { deletedLogs, deletedKeys, failedPending });
  return { deletedLogs, deletedKeys, failedPending };
}
