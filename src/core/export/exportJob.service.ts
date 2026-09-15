import { randomUUID } from 'node:crypto';
import { ExportJob } from '@database/models/exportJob.model';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { exportConfig } from './exportConfig';
import type { ExportFileFormat } from './exportTypes';

export async function createExportJob(params: {
  ownerId: string;
  domain: string;
  exportType: string;
  format: ExportFileFormat;
  filters: Record<string, unknown>;
}): Promise<ExportJob> {
  return ExportJob.create({
    id: randomUUID(),
    ownerId: params.ownerId,
    domain: params.domain,
    exportType: params.exportType,
    format: params.format,
    filters: params.filters,
  });
}

/** Ownership-checked fetch — throws 404 (not 403) so job IDs can't be probed for existence. */
export async function getOwnedExportJob(jobId: string, ownerId: string): Promise<ExportJob> {
  const job = await ExportJob.findByPk(jobId);
  if (!job || job.ownerId !== ownerId) {
    throw new NotFoundError(ERROR_MESSAGES.EXPORT_JOB_NOT_FOUND);
  }
  return job;
}

export async function listExportJobsForUser(ownerId: string, limit = 20): Promise<ExportJob[]> {
  return ExportJob.findAll({
    where: { ownerId },
    order: [['createdAt', 'DESC']],
    limit,
  });
}

export async function markProcessing(jobId: string): Promise<void> {
  await ExportJob.update({ status: 'PROCESSING', startedAt: new Date() }, { where: { id: jobId } });
}

export async function updateProgress(
  jobId: string,
  rowsProcessed: number,
  totalRowsEstimate: number | null,
): Promise<void> {
  const progressPercent = totalRowsEstimate
    ? Math.min(99, Math.round((rowsProcessed / totalRowsEstimate) * 100))
    : 0;
  await ExportJob.update({ rowsProcessed, totalRowsEstimate, progressPercent }, { where: { id: jobId } });
}

export async function markCompleted(
  jobId: string,
  result: { resultKey: string; filename: string; byteSize: number; rowsProcessed: number },
): Promise<void> {
  await ExportJob.update(
    {
      status: 'COMPLETED',
      progressPercent: 100,
      resultKey: result.resultKey,
      filename: result.filename,
      byteSize: result.byteSize,
      rowsProcessed: result.rowsProcessed,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + exportConfig.jobTtlHours * 60 * 60 * 1000),
    },
    { where: { id: jobId } },
  );
}

export async function markFailed(jobId: string, errorMessage: string, errorCode = 'EXPORT_FAILED'): Promise<void> {
  await ExportJob.update(
    { status: 'FAILED', errorMessage: errorMessage.slice(0, 500), errorCode, completedAt: new Date() },
    { where: { id: jobId } },
  );
}

export async function cancelQueuedExportJob(jobId: string, ownerId: string): Promise<void> {
  const job = await getOwnedExportJob(jobId, ownerId);
  if (job.status !== 'QUEUED') {
    throw new ForbiddenError(ERROR_MESSAGES.EXPORT_JOB_NOT_CANCELLABLE);
  }
  await ExportJob.update({ status: 'CANCELLED' }, { where: { id: jobId } });
}

/**
 * Marks a finished job "seen" — called when the owner downloads it or
 * explicitly dismisses it from the tray. This is what stops a job that
 * finished while the browser was closed from resurfacing on every future
 * visit: `listExportJobsForUser` returns it forever (it's real history),
 * but the frontend's reload-recovery sweep (Step 17) only re-tracks
 * unacknowledged finished jobs, so an acknowledged one stays out of the way
 * without being deleted. Deletion is still handled separately, by the TTL
 * cleanup job (Step 12) — acknowledging a job does not shorten its life in
 * S3, it only stops the tray from mentioning it again.
 */
export async function acknowledgeExportJob(jobId: string, ownerId: string): Promise<void> {
  const job = await getOwnedExportJob(jobId, ownerId);
  if (job.status !== 'COMPLETED' && job.status !== 'FAILED') return; // no-op for QUEUED/PROCESSING/CANCELLED
  await ExportJob.update({ acknowledgedAt: new Date() }, { where: { id: jobId } });
}
