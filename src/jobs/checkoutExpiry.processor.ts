import { logger } from '@core/logger';
import { processPaymentPendingReminders } from '@modules/notifications/events/orderEvents';
import {
  expireAbandonedCheckouts,
  type AbandonedCheckoutRun,
} from '@modules/payments/abandonedCheckouts';

export const CHECKOUT_EXPIRY_JOB = 'checkout-expiry';

/** Settle online checkouts left unpaid past their payment window (see expireAbandonedCheckouts). */
export async function runCheckoutExpiry(): Promise<AbandonedCheckoutRun> {
  // Halfway through the window, remind shoppers still to pay; then release the ones past it.
  await processPaymentPendingReminders().catch((error) => logger.warn('Payment reminders failed', { error: error instanceof Error ? error.message : error }));
  const result = await expireAbandonedCheckouts();
  logger.info('Checkout expiry finished', result);
  return result;
}
