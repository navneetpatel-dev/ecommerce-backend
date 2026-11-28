/**
 * Imported first by the seed: while it runs, nothing can leave this machine. Mail is switched
 * off (the app's own code runs during the seed and would otherwise queue real messages to the
 * seeded inboxes) and queued jobs go to a spare Redis database no worker reads.
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SEED_REDIS_DB = 15;

/** The Redis the app itself uses: the low-stock digest memory belongs there (see `settle.ts`). */
export const APP_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function onSpareDatabase(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${SEED_REDIS_DB}`;
  return parsed.toString();
}

process.env.REDIS_URL = onSpareDatabase(APP_REDIS_URL);
for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
  process.env[key] = '';
}
process.env.START_WORKERS_IN_API = 'false';
