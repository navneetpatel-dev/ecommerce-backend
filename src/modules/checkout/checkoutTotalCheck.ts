import { AppError } from '@core/errors/AppError';
import { toPaise } from '@modules/pricing/money';

export const CHECKOUT_TOTAL_CHANGED = 'CHECKOUT_TOTAL_CHANGED';

/**
 * The order is placed only at the total the customer last saw. Between that quote and
 * the click a price, coupon, shipping rate or the gift wrap may have changed; COD has no
 * payment screen to show the new total, so the order would go through at an amount
 * nobody confirmed. Older clients send no expected total and are not checked.
 */
export function assertExpectedGrandTotal(expectedGrandTotal: number | undefined, grandTotal: number): void {
  if (expectedGrandTotal == null) return;
  if (toPaise(expectedGrandTotal) === toPaise(grandTotal)) return;
  throw new AppError(
    'Your order total has changed. Please review the updated total and place the order again.',
    409,
    CHECKOUT_TOTAL_CHANGED,
    { grandTotal },
  );
}
