import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { formatInrAmount } from '@core/pdf/pdfFormatters';
import { fromPaise, toPaise } from '@modules/pricing/money';

/** A coupon that can't be used, with its own code so clients can tell why. */
export function couponRejected(reason: string | null | undefined, reasonCode?: string | null): AppError {
  return new AppError(
    reason ?? ERROR_MESSAGES.COUPON_INVALID,
    422,
    (reasonCode ?? ERROR_CODES.COUPON_INVALID) as typeof ERROR_CODES.COUPON_INVALID,
  );
}

/**
 * Why a minimum-order coupon isn't applying, with what it takes: "Add ₹820.00 more to use
 * this coupon (minimum order ₹2,000.00)". The shopper sees the gap instead of guessing.
 */
export function minOrderShortfallMessage(minimum: number, subtotal: number): string {
  const short = fromPaise(Math.max(0, toPaise(minimum) - toPaise(subtotal)));
  return `Add ₹${formatInrAmount(short)} more to use this coupon (minimum order ₹${formatInrAmount(minimum)})`;
}

/** The same for a minimum number of items: "Add 1 more item to use this coupon (minimum 2)". */
export function minQuantityShortfallMessage(minimum: number, quantity: number): string {
  const short = Math.max(0, minimum - quantity);
  return `Add ${short} more ${short === 1 ? 'item' : 'items'} to use this coupon (minimum ${minimum})`;
}
