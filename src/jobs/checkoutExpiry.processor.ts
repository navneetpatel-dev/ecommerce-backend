import { logger } from '@core/logger';
import { paymentsService } from '@modules/payments/payments.service';

export const CHECKOUT_EXPIRY_JOB = 'checkout-expiry';

/** Cancel online checkouts left unpaid past their payment window (see expireAbandonedCheckouts). */
export async function runCheckoutExpiry(): Promise<{ expired: number; skipped: number }> {
  const result = await paymentsService.expireAbandonedCheckouts();
  logger.info('Checkout expiry finished', result);
  return result;
}
