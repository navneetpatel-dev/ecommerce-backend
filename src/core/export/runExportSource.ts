import { createExportWriter } from './writers';
import { exportConfig } from './exportConfig';
import type { ExportSource, ExportFileFormat, ExportArtifact } from './exportTypes';
import { ValidationError } from '@core/errors/ValidationError';

export type RunExportSourceResult = ExportArtifact & { rowCount: number };

function abortedError(): Error {
  return new Error('Export aborted — timed out or was cancelled');
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(abortedError()), { once: true });
  });
}

/**
 * Streams `source.rows()` through the right format writer straight into
 * `sink` — the caller (the export worker, Step 08) owns `sink` and is
 * simultaneously reading from it (or from whatever it's piped to) to
 * upload to S3, so row generation, formatting, and upload all overlap
 * instead of running as three sequential phases.
 *
 * `onProgress` fires on *either* threshold, whichever comes first: every
 * `exportConfig.progressUpdateEveryRows` rows, or every
 * `exportConfig.progressHeartbeatMs` milliseconds — the time-based leg
 * exists so a slow single chunk (e.g. CPU-heavy PDF rendering) can't leave
 * the UI with no signal for an unbounded stretch.
 *
 * `signal`, when provided, is checked before each chunk *and* raced against
 * the in-flight `iterator.next()` wait. We still cannot cancel an underlying
 * Sequelize query from here (no DB-level kill), so a hung query may keep
 * running in the background — but we stop *waiting* on it the moment the
 * caller's inactivity timeout (Step 08) aborts the signal. Without that
 * race, a chunk that never resolves would ignore abort entirely and hang
 * the job past the stall ceiling. Aborting throws, which the `catch` below
 * turns into the same disposal path as any other failure — no special-casing
 * needed at the call site.
 */
export async function runExportSource(
  source: ExportSource,
  format: ExportFileFormat,
  sink: NodeJS.WritableStream,
  onProgress?: (rowsProcessed: number, estimatedTotal: number | null) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<RunExportSourceResult> {
  const writer = createExportWriter(format, source.columns, source.title, sink);
  const estimatedTotal = source.estimateTotal ? await source.estimateTotal() : null;

  try {
    await writer.writeHeader();
    let rowCount = 0;
    let rowsSinceLastProgress = 0;
    let lastProgressAt = Date.now();
    const maxRows = exportConfig.maxRows;

    const iterator = source.rows()[Symbol.asyncIterator]();
    for (;;) {
      if (signal?.aborted) {
        throw abortedError();
      }
      const next = iterator.next();
      const { value: chunk, done } = signal
        ? await Promise.race([next, waitForAbort(signal)])
        : await next;
      if (done || !chunk) break;
      if (maxRows > 0 && rowCount + chunk.length > maxRows) {
        throw new ValidationError(
          `Export exceeds maximum row limit (${maxRows.toLocaleString()}) — narrow the filters`,
        );
      }
      rowCount += chunk.length;
      rowsSinceLastProgress += chunk.length;
      await writer.writeRows(chunk);

      const dueByRowCount = rowsSinceLastProgress >= exportConfig.progressUpdateEveryRows;
      const dueByTime = Date.now() - lastProgressAt >= exportConfig.progressHeartbeatMs;
      if (onProgress && (dueByRowCount || dueByTime)) {
        rowsSinceLastProgress = 0;
        lastProgressAt = Date.now();
        await onProgress(rowCount, estimatedTotal);
      }
    }
    if (onProgress) await onProgress(rowCount, estimatedTotal);

    return { ...(await writer.finalize()), rowCount };
  } catch (err) {
    await writer.dispose().catch(() => undefined);
    throw err;
  }
}
