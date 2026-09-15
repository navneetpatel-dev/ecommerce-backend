import { queueEvents } from '@config/queue';
import { logger } from '@core/logger';

/**
 * Plain-object I/O seam — named ESM exports are live getters and cannot be
 * replaced with `mock.method`. Tests mock these properties instead of
 * importing `socket.ts` (which pulls Sequelize models and would leave
 * open sockets). Production wires `emitExportJobEvent` from server.ts
 * immediately before `bindExportQueueEvents()`.
 */
export const exportProgressBridgeIo = {
  emitExportJobEvent: (
    _jobId: string,
    _event: 'export:progress' | 'export:completed' | 'export:failed',
    _payload: Record<string, unknown>,
  ): void => {},
  warn: (message: string, meta?: Record<string, unknown>) => logger.warn(message, meta),
};

let bound = false;

type ExportQueueEventBus = {
  on(event: 'progress' | 'completed' | 'failed' | string, listener: (payload: { jobId: string; data?: unknown; failedReason?: string }) => void): unknown;
};

/** Call once from server.ts, after both initSocket() and connectQueues() succeed. */
export function bindExportQueueEvents(events?: ExportQueueEventBus): void {
  if (bound) return;
  bound = true;
  const bus = events ?? queueEvents.exports;

  bus.on('progress', ({ jobId, data }) => {
    // `data` is whatever Step 08 passed to `job.updateProgress({ rowsProcessed, total })`,
    // round-tripped through Redis — BullMQ documents that a 'progress' event's
    // `data` mirrors what was stored, but that round-trip isn't statically
    // typed anywhere in this pipeline, so it's validated here rather than
    // blindly cast. The reason this matters more than a normal defensive
    // check: a malformed shape doesn't just produce a wrong number on
    // screen — `lastSocketEventAtRef` (Step 17) marks a job "socket is
    // healthy" the instant *any* `export:progress` event arrives for it,
    // regardless of whether the payload made sense. An event that fires
    // regularly but carries garbage would keep resetting that staleness
    // clock while showing wrong (likely stuck-at-0%) progress — silently
    // *suppressing* the poll fallback that exists specifically to catch
    // this, instead of triggering it. Dropping the event here — not
    // emitting anything — is what keeps that fallback able to do its job:
    // no `export:progress` reaches the browser for this tick, so
    // `lastSocketEventAtRef` for this job isn't touched, and the next poll
    // correctly finds it stale and takes over.
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      exportProgressBridgeIo.warn('export_progress_event_malformed', { jobId, data });
      return;
    }
    const progress = data as { rowsProcessed?: unknown; total?: unknown };
    if (typeof progress.rowsProcessed !== 'number') {
      exportProgressBridgeIo.warn('export_progress_event_malformed', { jobId, data });
      return;
    }
    exportProgressBridgeIo.emitExportJobEvent(jobId, 'export:progress', {
      jobId,
      rowsProcessed: progress.rowsProcessed,
      total: typeof progress.total === 'number' ? progress.total : null,
    });
  });

  bus.on('completed', ({ jobId }) => {
    exportProgressBridgeIo.emitExportJobEvent(jobId, 'export:completed', { jobId });
  });

  // Safe to treat as final the instant it fires: Step 08 handles its own
  // internal retry loop and only ever throws (which is what produces this
  // event) after that budget is exhausted — BullMQ's own `attempts` is set
  // to 1 (Step 10), so there is no "one more retry coming" case here to
  // accidentally flash a false failure for. If Step 08's retry design ever
  // changes back to BullMQ-level `attempts`, this line stops being safe —
  // re-read Step 08's "Why retries are internal, not BullMQ's" note first.
  bus.on('failed', ({ jobId, failedReason }) => {
    exportProgressBridgeIo.emitExportJobEvent(jobId, 'export:failed', { jobId, message: failedReason });
  });

  logger.info('Export queue events bridged to Socket.IO');
}
