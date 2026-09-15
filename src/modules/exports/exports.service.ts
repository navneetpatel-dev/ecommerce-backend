import { queues } from '@config/queue';
import { RUN_EXPORT_JOB } from '@jobs/export.processor';
import {
  createExportJob,
  getOwnedExportJob,
  listExportJobsForUser,
  cancelQueuedExportJob,
  acknowledgeExportJob,
  markFailed,
} from '@core/export/exportJob.service';
import { listRegisteredExportDomains } from '@core/export/exportSourceRegistry';
import { signedGetObjectUrl } from '@config/s3';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import type { CreateExportJobInput } from './exports.dto';
import type { ExportActor } from '@core/export/exportSourceRegistry';

export async function startExport(
  actor: ExportActor,
  input: CreateExportJobInput,
): Promise<{ jobId: string; status: string }> {
  if (!listRegisteredExportDomains().includes(input.domain)) {
    throw new ValidationError(`Unknown export domain: ${input.domain}`);
  }
  const job = await createExportJob({
    ownerId: actor.id,
    domain: input.domain,
    exportType: input.exportType,
    format: input.format,
    filters: input.filters,
  });
  try {
    await queues.exports.add(
      RUN_EXPORT_JOB,
      { exportJobId: job.id, actor },
      {
        jobId: job.id,
        // Deliberately 1, not more — retries happen *inside* Step 08's
        // `processExportJob` (its own internal loop, `MAX_ATTEMPTS = 2`),
        // not via BullMQ's own attempts mechanism. See Step 08's "Why
        // retries are internal, not BullMQ's" note: it's what keeps
        // Step 09's bridge from ever telling the browser "failed" on an
        // attempt that's actually about to succeed on retry. Don't bump
        // this without re-reading that note first.
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    );
  } catch (err) {
    // The DB row above was created successfully but nothing will ever
    // process it if this throws (Redis/the queue itself unreachable) — a
    // phantom row stuck at QUEUED forever otherwise, one Step 12's cleanup
    // sweep wouldn't even catch (it only sweeps COMPLETED/FAILED/
    // CANCELLED). Mark it failed immediately so the two writes succeed or
    // fail together in effect, even though they aren't in one DB
    // transaction (there's nothing to roll back — enqueueing isn't a DB
    // operation — so "compensate immediately after" is the correct
    // pattern here, not a workaround).
    await markFailed(job.id, 'Could not queue the export — please try again').catch(() => undefined);
    throw err;
  }
  return { jobId: job.id, status: String(job.status) };
}

export async function getExportStatus(actor: ExportActor, jobId: string): Promise<{
  jobId: string;
  status: string;
  progressPercent: number;
  rowsProcessed: number;
  totalRowsEstimate: number | null;
  filename: string | null;
  errorMessage: string | null;
}> {
  const job = await getOwnedExportJob(jobId, actor.id);
  return {
    jobId: job.id,
    status: String(job.status),
    progressPercent: job.progressPercent,
    rowsProcessed: job.rowsProcessed,
    totalRowsEstimate: job.totalRowsEstimate,
    filename: job.filename,
    errorMessage: job.errorMessage,
  };
}

export async function getExportDownloadUrl(actor: ExportActor, jobId: string): Promise<string> {
  const job = await getOwnedExportJob(jobId, actor.id);
  if (job.status !== 'COMPLETED' || !job.resultKey) {
    // Not EXPORT_JOB_NOT_FOUND — ownership/existence was already confirmed
    // by getOwnedExportJob above. This is a different, later situation:
    // the caller's own job exists but isn't finished. See Step 07's note
    // on EXPORT_JOB_NOT_READY for why these two need separate messages.
    throw new ForbiddenError(ERROR_MESSAGES.EXPORT_JOB_NOT_READY);
  }
  return signedGetObjectUrl(job.resultKey, 15 * 60);
}

export async function listMyExports(actor: ExportActor): Promise<
  Array<{
    id: string;
    domain: string;
    exportType: string;
    format: string;
    status: string;
    progressPercent: number;
    filename: string | null;
    errorMessage: string | null;
    acknowledgedAt: Date | null;
    createdAt: Date;
  }>
> {
  const jobs = await listExportJobsForUser(actor.id);
  // Explicit field mapping, deliberately — `listExportJobsForUser` returns
  // raw Sequelize instances, and returning those directly (an earlier
  // draft of this plan did exactly that) would serialize *every* column
  // straight to the client: `ownerId` (redundant — the endpoint is already
  // scoped to the caller), `resultKey` (an internal S3 object key, not
  // meant to leave the server; `GET /:jobId/download` is the only
  // sanctioned way to get at the file, via a signed, expiring URL), raw
  // `filters` (fine for `report` domain filters today, but this module has
  // no way to know that holds for every future domain that registers
  // itself), and `errorCode` (an internal classification, not something a
  // UI needs). `getExportStatus` right below already does this shaping
  // deliberately — this brings the list endpoint in line with it instead
  // of being the one endpoint in the module that skips it.
  return jobs.map((job) => ({
    id: job.id,
    domain: job.domain,
    exportType: job.exportType,
    format: job.format,
    status: String(job.status),
    progressPercent: job.progressPercent,
    filename: job.filename,
    errorMessage: job.errorMessage,
    acknowledgedAt: job.acknowledgedAt,
    createdAt: job.createdAt,
  }));
}

export async function cancelExport(actor: ExportActor, jobId: string): Promise<void> {
  await cancelQueuedExportJob(jobId, actor.id);
  const bullJob = await queues.exports.getJob(jobId);
  if (bullJob) await bullJob.remove();
}

export async function acknowledgeExport(actor: ExportActor, jobId: string): Promise<void> {
  await acknowledgeExportJob(jobId, actor.id);
}
