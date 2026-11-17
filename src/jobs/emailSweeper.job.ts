import { logger } from '@core/logger';
import { sweepStaleEmails } from '@modules/notifications/emailRecovery';
import { getEmailHealth, type EmailHealthStatus } from '@modules/notifications/emailHealth.service';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** A standing problem is logged again this often, so it stays visible without flooding the log. */
const REPEAT_ALERT_MS = 30 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;
let lastStatus: EmailHealthStatus = 'OK';
let lastAlertAt = 0;

/** Logs when delivery goes bad (an error a monitor can alert on), while it stays bad, and when it recovers. */
async function watchHealth(): Promise<void> {
  const health = await getEmailHealth();
  const now = Date.now();
  if (health.status !== 'OK') {
    if (lastStatus === 'OK' || health.status !== lastStatus || now - lastAlertAt > REPEAT_ALERT_MS) {
      logger.error('Email delivery is unhealthy', { status: health.status, headline: health.headline, sent: health.sent, failed: health.failed, stuck: health.stuck, lastFailure: health.lastFailure });
      lastAlertAt = now;
    }
  } else if (lastStatus !== 'OK') {
    logger.info('Email delivery recovered', { sent: health.sent });
  }
  lastStatus = health.status;
}

async function sweep(): Promise<void> {
  try {
    const { requeued, expired } = await sweepStaleEmails();
    if (requeued > 0 || expired > 0) logger.info('Email sweeper tick', { requeued, expired });
    await watchHealth();
  } catch (error) {
    logger.warn('Email sweeper failed', { error: error instanceof Error ? error.message : error });
  }
}

/** Re-queues emails stuck PENDING (queue was down) or that failed on a temporary mail-server error, and watches delivery health. */
export function startEmailSweeper(): void {
  if (timer) return;
  void sweep();
  timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  logger.info('Email sweeper started', { intervalMs: SWEEP_INTERVAL_MS });
}

export function stopEmailSweeper(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
