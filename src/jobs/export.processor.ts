import { Worker, type Job } from 'bullmq';
import { getQueueConnection } from '@config/queue';
import { logger } from '@core/logger';
import { uploadObjectStream, S3_BUCKET } from '@config/s3';
import { buildS3Key } from '@core/s3';
import { AppError } from '@core/errors';
import { runExportSource } from '@core/export/runExportSource';
import { resolveExportSource, type ExportActor } from '@core/export/exportSourceRegistry';
import { exportConfig, contentTypeForExportFormat, ByteCountingPassThrough } from '@core/export';
import {
  markProcessing,
  updateProgress,
  markCompleted,
  markFailed,
} from '@core/export/exportJob.service';
import { ExportJob } from '@database/models/exportJob.model';

/**
 * Plain-object I/O seam. Node's `mock.method` cannot replace named ESM
 * exports (they are live getters with `configurable: false`); the worker
 * tests mock these properties instead. Production always uses the real
 * functions assigned at module load.
 */
export const exportProcessorIo = {
  uploadObjectStream,
  resolveExportSource,
  markProcessing,
  updateProgress,
  markCompleted,
  markFailed,
  sleep,
};

/**
 * `ValidationError`/`ForbiddenError`/`NotFoundError`/etc. all extend
 * `AppError` and are written throughout this codebase to already be safe,
 * specific, user-facing text ("Report not found", "Export exceeds maximum
 * row limit…"). Anything else — a raw DB driver error, an unexpected AWS
 * SDK exception, a bug — was never written with an end user as its
 * audience and may describe internal structure. The full message always
 * goes to `logger.error` either way; only what reaches the browser is
 * gated here.
 */
function publicFailureMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'Export failed — please try again or contact support if this keeps happening';
}

export type ExportJobPayload = {
  exportJobId: string;
  actor: ExportActor;
};

const RUN_EXPORT_JOB = 'run-export';

/**
 * Retries are handled *inside* this file, not via BullMQ's `attempts`
 * option (Step 10 sets `attempts: 1`) — see "Why retries are internal, not
 * BullMQ's" below for the reasoning. `MAX_ATTEMPTS` tries, `RETRY_DELAY_MS`
 * apart, all within the *same* BullMQ job.
 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One attempt at producing and uploading the file. Throws on any failure — the caller decides whether to retry. */
async function runOneAttempt(
  job: Job<ExportJobPayload>,
  row: ExportJob,
  signal: AbortSignal,
  onAlive: () => void,
): Promise<{ s3Key: string; filename: string; byteSize: number; rowCount: number }> {
  const resolver = exportProcessorIo.resolveExportSource(row.domain);
  const source = await resolver(job.data.actor, row.exportType, row.filters);

  const filename = `${row.exportType}-${row.id.slice(0, 8)}.${row.format}`;
  // Live `buildS3Key` is positional (`entityType, entityId, purpose, filename`),
  // not the object-shaped call an earlier draft of the plan assumed. `'export'`
  // / `'export-artifact'` are registered in `S3_ENTITY_TYPES` / `S3_PURPOSES`
  // so this still goes through the existing validator rather than inventing a
  // key format. `buildS3Key` itself always inserts a random UUID segment — so
  // retries do not overwrite the same object key (the plan's "deterministic
  // from exportJobId" note does not hold for the live helper). `markCompleted`
  // records whichever key the successful attempt produced.
  const s3Key = buildS3Key(
    'export',
    row.id,
    'export-artifact',
    `${row.exportType}.${row.format}`,
  );

  // Single pipeline, no local temp file: `sink` is written into by the
  // format writer (inside runExportSource) and read from by the S3 upload
  // at the same time — kicked off here, *before* a single row has been
  // generated, so bytes start reaching S3 as soon as they exist rather
  // than only after the whole file is built.
  const sink = new ByteCountingPassThrough();
  // Destroying `sink` (upload failure, inactivity abort) emits `error`.
  // Swallow it here so Node doesn't treat that as an uncaughtException
  // when the writer hasn't attached an error listener yet — the cause is
  // still surfaced via `uploadError` / the writer catch below.
  sink.on('error', () => undefined);
  let uploadError: unknown = null;
  const uploadPromise = exportProcessorIo.uploadObjectStream({
    key: s3Key,
    stream: sink,
    contentType: contentTypeForExportFormat(row.format),
    privateObject: true,
    contentDisposition: `attachment; filename="${filename}"`,
  }).catch((err) => {
    // An S3-side failure (network drop mid-upload, a 5xx from S3) must not
    // leave the writer stuck forever waiting on backpressure from a
    // consumer that stopped reading. Destroying the sink here forces any
    // in-flight `sink.write()` inside the CSV/XLSX/PDF writer to fail
    // immediately — this is deliberate, unconditional insurance, not a
    // bet that the AWS SDK already does this for us.
    //
    // Do *not* rethrow from this `.catch()`: if the writer already threw
    // because we destroyed the sink, `await uploadPromise` below never
    // runs, and a rethrow here becomes an unhandledRejection on a
    // promise nobody is awaiting. `uploadError` is what surfaces the
    // real cause (see the writer catch immediately below).
    uploadError = err;
    sink.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  let result;
  try {
    result = await runExportSource(
      source,
      row.format,
      sink,
      async (rowsProcessed, total) => {
        // Real forward progress just happened — re-arm the inactivity
        // timeout *before* attempting either broadcast below, so a Redis
        // or DB hiccup on the broadcasts themselves (handled as best-effort
        // failures immediately below) can never suppress the "we're alive"
        // signal this represents. Row-writing progress is what "alive"
        // means here, not whether anyone got told about it.
        onAlive();
        // Progress reporting is best-effort, deliberately. A transient
        // Redis or DB blip while broadcasting a percentage must never fail
        // an otherwise-healthy export that is still correctly streaming
        // rows to S3 — only the row-writing and upload paths (outside this
        // callback) are allowed to fail the job. The two writes are
        // guarded independently so a Redis hiccup doesn't also skip the
        // unrelated DB progress write, or vice versa.
        await job.updateProgress({ rowsProcessed, total }).catch((err) => {
          logger.warn('export_progress_broadcast_failed', {
            exportJobId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        await exportProcessorIo.updateProgress(row.id, rowsProcessed, total).catch((err) => {
          logger.warn('export_progress_persist_failed', {
            exportJobId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      signal,
    );
  } catch (writerErr) {
    // If the writer failed because we just destroyed the sink in response
    // to an upload error, surface *that* error — it's the real cause, not
    // whatever generic "stream destroyed" message Node's stream internals
    // hand back to the writer.
    throw uploadError ?? writerErr;
  }

  if (uploadError) throw uploadError;
  await uploadPromise;
  return { s3Key, filename, byteSize: sink.bytesWritten, rowCount: result.rowCount };
}

async function processExportJob(job: Job<ExportJobPayload>): Promise<void> {
  const { exportJobId } = job.data;
  const row = await ExportJob.findByPk(exportJobId);
  if (!row) {
    logger.warn('Export job row missing — skipping', { exportJobId });
    return;
  }
  if (row.status === 'CANCELLED') return;
  // Defends against BullMQ redelivering a job it considers "stalled" (the
  // worker holding its lock died, or was too slow to heartbeat) *after* a
  // previous run already finished successfully — without this guard, a
  // redelivery would silently re-upload and re-mark-complete a job the
  // user already has the real result of. Cheap, and correct regardless of
  // exactly when or why BullMQ decided to redeliver.
  if (row.status === 'COMPLETED') return;

  await exportProcessorIo.markProcessing(exportJobId);

  const controller = new AbortController();
  const inactivityMs = exportConfig.maxInactivityMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  // Armed before the first attempt (covers a hang in source resolution or
  // the first DB query, before any row has ever been written) and re-armed
  // by `onAlive()` on every real progress signal thereafter — see
  // exportConfig.maxInactivityMs's doc comment for why this has to be an
  // inactivity timer and not a single fixed deadline.
  const armInactivityTimeout = () => {
    clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => controller.abort(), inactivityMs);
  };
  armInactivityTimeout();

  let lastError: unknown;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (controller.signal.aborted) break;
      try {
        const outcome = await runOneAttempt(job, row, controller.signal, armInactivityTimeout);
        await exportProcessorIo.markCompleted(exportJobId, {
          resultKey: outcome.s3Key,
          filename: outcome.filename,
          byteSize: outcome.byteSize,
          rowsProcessed: outcome.rowCount,
        });
        logger.info('export_job_completed', {
          exportJobId,
          domain: row.domain,
          exportType: row.exportType,
          rowCount: outcome.rowCount,
          byteSize: outcome.byteSize,
          bucket: S3_BUCKET,
          attempt,
        });
        return;
      } catch (err) {
        lastError = err;
        logger.warn('export_job_attempt_failed', {
          exportJobId,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < MAX_ATTEMPTS && !controller.signal.aborted) {
          await exportProcessorIo.sleep(RETRY_DELAY_MS);
        }
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const timedOut = controller.signal.aborted;
  const message = timedOut
    ? // "Stalled," not "too large": this only fires after zero progress for
      // the full inactivity window, so — unlike the old fixed-duration
      // design — a genuinely huge-but-healthy export never reaches this
      // branch. Advising the user to narrow filters would be misleading
      // advice for what's actually a stuck dependency, not too much data.
      `Export stalled with no progress for ${Math.round(inactivityMs / 60_000)} minutes — please try again`
    : publicFailureMessage(lastError);

  try {
    await exportProcessorIo.markFailed(exportJobId, message);
  } catch (writeErr) {
    // If even this write fails (DB unreachable at the worst possible
    // moment), the row is left stuck at PROCESSING instead of FAILED —
    // there's nothing more this function can safely do about that *right
    // now*. Step 12's daily cleanup sweep is the backstop: it force-fails
    // any row that's been PROCESSING far longer than a real export ever
    // legitimately takes, so this still resolves for the user, just not
    // immediately. Rethrowing below regardless is what keeps BullMQ's own
    // job-level bookkeeping accurate even when our DB write didn't land.
    logger.error('export_job_mark_failed_write_failed', {
      exportJobId,
      originalError: message,
      writeError: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
  logger.error('export_job_failed', {
    exportJobId,
    error: message,
    rawError: lastError instanceof Error ? lastError.message : String(lastError),
    timedOut,
  });
  throw lastError instanceof Error ? lastError : new Error(message);
}

export function startExportWorker(): Worker {
  const worker = new Worker<ExportJobPayload>(
    'exports',
    async (job) => {
      if (job.name === RUN_EXPORT_JOB) {
        await processExportJob(job);
      }
    },
    { connection: getQueueConnection(), concurrency: exportConfig.workerConcurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error('Export worker job failed', { jobId: job?.id, error: err.message });
  });

  return worker;
}

export async function stopExportWorker(worker: Worker | null): Promise<void> {
  if (worker) await worker.close();
}

export { RUN_EXPORT_JOB, processExportJob };
