import { logger } from '@core/logger';
import {
  expireAbandonedCheckouts,
  type AbandonedCheckoutRun,
} from '@modules/payments/abandonedCheckouts';

export const CHECKOUT_EXPIRY_JOB = 'checkout-expiry';

/** Settle online checkouts left unpaid past their payment window (see expireAbandonedCheckouts). */
export async function runCheckoutExpiry(): Promise<AbandonedCheckoutRun> {
  const result = await expireAbandonedCheckouts();
  logger.info('Checkout expiry finished', result);
  return result;
}
