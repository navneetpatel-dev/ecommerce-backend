/**
 * Leaves nothing due to send. The jobs that run when the app starts (the scheduler, coupon
 * alerts, wallet expiry) run here with mail off, so whatever they would mail is recorded now (each email is keyed and never repeated);
 * then every queued message is marked delivered. The app's Redis is told which variants are
 * already low, so the first start does not send every vendor a low-stock email.
 */
import Redis from 'ioredis';
import { exec, select } from './lib';
import { APP_REDIS_URL } from './isolate';
import { runNotificationSchedulerTick } from '../../src/jobs/notificationScheduler.job';
import { runPromoPointsExpiry } from '../../src/jobs/promoPointsExpiry.processor';
import { runWalletRechargeExpiry } from '../../src/jobs/walletRechargeExpiry.processor';
import { couponsService } from '../../src/modules/coupons/coupons.service';

/** Must match `ALERTED_SET` in `src/jobs/lowStockDigest.ts`. */
const LOW_STOCK_ALERTED = 'low-stock:alerted';
/** Emails are queued after their transaction commits; give those writes time to land. */
const SETTLE_MS = 5_000;
/** The scheduler handles a batch (100 or 200 rows) a tick. */
const TICKS = 6;

const pause = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

async function rememberLowStock(): Promise<number> {
  const low = await select<{ id: string }>(
    `SELECT v.id FROM product_variants v JOIN products p ON p.id = v."productId" AND p."deletedAt" IS NULL
     WHERE v."deletedAt" IS NULL AND v.stock <= v."lowStockAt"`,
  );
  const redis = new Redis(APP_REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    await redis.del(LOW_STOCK_ALERTED);
    for (let i = 0; i < low.length; i += 1000) await redis.sadd(LOW_STOCK_ALERTED, ...low.slice(i, i + 1000).map((row) => row.id));
  } finally {
    await redis.quit();
  }
  return low.length;
}

export async function settle(): Promise<void> {
  await runPromoPointsExpiry();
  await runWalletRechargeExpiry();
  await couponsService.notifyExpiringAndNearLimit();
  for (let tick = 0; tick < TICKS; tick += 1) await runNotificationSchedulerTick();
  await pause();
  await exec(`
    UPDATE notification_logs SET status = 'SENT', error = NULL, "errorCategory" = NULL, "sendingAt" = NULL,
      "sentAt" = COALESCE("sentAt", "createdAt")
    WHERE status = 'PENDING' OR (status = 'FAILED' AND ("errorCategory" IS NULL OR "errorCategory" IN ('TEMPORARY', 'CONFIG')))`);
  console.log(`  ${await rememberLowStock()} low variants already known to the low-stock digest`);
}
