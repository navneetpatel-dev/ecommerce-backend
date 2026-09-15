import { env } from '@config/env';

export const exportConfig = {
  chunkSize: env.REPORT_EXPORT_CHUNK_SIZE,
  maxRows: env.REPORT_EXPORT_MAX_ROWS,
  workerConcurrency: env.EXPORT_WORKER_CONCURRENCY,
  jobTtlHours: env.EXPORT_JOB_TTL_HOURS,
  /** Progress emits are throttled by *either* threshold — whichever fires first. */
  progressUpdateEveryRows: 500,
  /** Time-based backstop so a slow chunk (e.g. heavy PDF rendering) can't leave the UI silent. */
  progressHeartbeatMs: 3_000,
  /**
   * **Inactivity** ceiling, not a total-duration one — the distinction
   * matters and is easy to get wrong (an earlier draft of this plan had it
   * wrong: a single `setTimeout` armed once at the start of an attempt,
   * which would abort a legitimately large, healthy, slowly-progressing
   * export at exactly this many minutes even while it was actively
   * succeeding — killing a real multi-hundred-thousand-row export for the
   * "crime" of taking longer than a small one). Step 08 re-arms this timer
   * on every progress signal, so it only ever fires when there has been
   * *no forward progress at all* for this long — a genuinely stuck
   * dependency (a locked table, an S3 connection that neither errors nor
   * completes), not merely a slow one. See Step 08's failure catalog note
   * for exactly what happens when it fires.
   */
  maxInactivityMs: env.EXPORT_JOB_MAX_INACTIVITY_MINUTES * 60_000,
} as const;
