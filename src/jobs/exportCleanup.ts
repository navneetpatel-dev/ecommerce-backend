import { Op } from 'sequelize';
import { ExportJob } from '@database/models/exportJob.model';
import { deleteObject } from '@config/s3';
import { exportConfig } from '@core/export';
import { logger } from '@core/logger';

export const EXPORT_CLEANUP_JOB = 'export-cleanup';
export const EXPORT_STALE_PROCESSING_SWEEP_JOB = 'export-stale-processing-sweep';

/** Expires completed artifacts past their TTL, and prunes old failed/cancelled rows. Daily — no urgency either way. */
export async function runExportCleanup(): Promise<{ deleted: number }> {
  const expired = await ExportJob.findAll({
    where: {
      status: 'COMPLETED',
      expiresAt: { [Op.lt]: new Date() },
    },
    limit: 500,
  });

  let deleted = 0;
  for (const job of expired) {
    if (job.resultKey) await deleteObject(job.resultKey);
    await job.destroy();
    deleted += 1;
  }

  const stale = await ExportJob.destroy({
    where: {
      status: { [Op.in]: ['FAILED', 'CANCELLED'] },
      updatedAt: { [Op.lt]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  logger.info('export_cleanup_completed', { deletedCompleted: deleted, deletedStale: stale });
  return { deleted: deleted + stale };
}

/**
 * Backstop for a job stuck at `PROCESSING` with nobody ever going to move
 * it out of that state — the two ways this can happen: (1) Step 08's own
 * `markFailed` write failed at the exact moment it needed to record a
 * real failure (rare, but not impossible — see the note in Step 08), or
 * (2) a worker crashed hard enough that neither its own error handling nor
 * BullMQ's stall detection ever ran. Either way, the user would otherwise
 * see "Processing…" forever with no path to a resolution.
 *
 * Threshold is measured off `updatedAt` (last write to the row), not
 * `startedAt` (when it began) — deliberately, and this is what keeps it
 * safe to run against a genuinely huge, healthy, still-progressing export:
 * every successful `updateProgress` call (Step 08) touches `updatedAt`, so
 * a job that's been running for three hours but wrote progress two minutes
 * ago has a *fresh* `updatedAt` and is correctly left alone — only a row
 * with no write at all in `2 × exportConfig.maxInactivityMs` looks stuck,
 * which is the same "no progress signal" condition Step 08's own inactivity
 * timeout is watching for from the other side. If `startedAt` were used
 * instead, this sweep would eventually force-fail every sufficiently long
 * *successful* export, which is exactly the bug the inactivity-timeout
 * redesign (Step 02) fixed on the worker's side — using `startedAt` here
 * would silently reintroduce the same bug one layer up.
 *
 * Runs every 15 minutes, not daily like `runExportCleanup` above — a job
 * that's really stuck deserves to resolve for the user within roughly an
 * hour (inactivity timeout + sweep interval), not up to a full day.
 */
export async function runStaleProcessingSweep(): Promise<{ failed: number }> {
  const staleBefore = new Date(Date.now() - 2 * exportConfig.maxInactivityMs);
  const [failed] = await ExportJob.update(
    {
      status: 'FAILED',
      errorMessage: 'Export did not complete — please try again',
      errorCode: 'EXPORT_STUCK',
      completedAt: new Date(),
    },
    {
      where: { status: 'PROCESSING', updatedAt: { [Op.lt]: staleBefore } },
    },
  );
  if (failed > 0) {
    logger.warn('export_stale_processing_swept', { failed, staleBefore });
  }
  return { failed };
}
