import { logger } from '@core/logger';

/**
 * Runs a storage clean-up that follows a database change which has already happened.
 * A failure here must not fail the request: the row is gone, so an error would tell
 * the user the action failed and a retry would answer 404. The objects are left
 * behind and the failure is logged for a later sweep.
 */
export async function bestEffortCleanup(
  label: string,
  meta: Record<string, unknown>,
  run: () => Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    const e = (error ?? {}) as { name?: unknown; message?: unknown };
    logger.warn(`${label} failed; objects left in storage`, { ...meta, error: { name: e.name, message: e.message } });
    return 0;
  }
}
