import { logger } from '@core/logger';
import { processReopenWindowReminders } from '@modules/notifications/events/supportEvents';
import { processExpiringPointsReminders } from '@modules/notifications/events/walletEvents';
import { processKycReminders } from '@modules/notifications/events/vendorEvents';
import { processAdminDailyDigest, processVendorWeeklySummaries, processWishlistDigests } from '@modules/notifications/events/digestEvents';

/**
 * Emails that go out on a calendar rather than in answer to one event. The scheduler calls
 * this every hour; each step either runs only in its own hour (UTC) or is safe to repeat,
 * because every email is keyed to what it is about (a day, a week, a record) and is never sent twice.
 */
export async function runPeriodicEmails(now: Date = new Date()): Promise<Record<string, number>> {
  const hour = now.getUTCHours();
  const weekday = now.getUTCDay();
  const results: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<number>) => {
    try {
      results[name] = await run();
    } catch (error) {
      logger.warn('Periodic email step failed', { step: name, error: error instanceof Error ? error.message : error });
    }
  };

  // Every hour: cheap, and keyed so a repeat sends nothing.
  await step('reopenReminders', () => processReopenWindowReminders(now));
  await step('pointsExpiring', () => processExpiringPointsReminders(now));
  // Daily 03:30 UTC (9:00 AM IST).
  if (hour === 3) {
    await step('adminDigest', () => processAdminDailyDigest(now));
    await step('kycReminders', () => processKycReminders(now));
  }
  // Mondays 04:00 UTC: the seller week. Wednesdays 05:00 UTC: wishlist price drops.
  if (weekday === 1 && hour === 4) await step('vendorWeekly', () => processVendorWeeklySummaries(now));
  if (weekday === 3 && hour === 5) await step('wishlistDigest', () => processWishlistDigests(now));
  return results;
}
