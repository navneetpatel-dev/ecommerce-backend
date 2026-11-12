import { AppError } from '@core/errors/AppError';
import { Order } from '@database/models/order.model';
import { logger } from '@core/logger';

export const PAYMENTS_UNAVAILABLE =
  'Payments are unavailable right now. Your cart is saved, so please try again in a few minutes.';

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/** True when the payment provider could not be reached or failed on its side (network, 5xx). */
export function isProviderUnreachable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const e = current as { code?: unknown; statusCode?: unknown; status?: unknown; message?: unknown; cause?: unknown; error?: unknown };
    if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true;
    const status = Number(e.statusCode ?? e.status);
    if (Number.isFinite(status) && status >= 500) return true;
    if (typeof e.message === 'string' && /fetch failed|socket hang up|network/i.test(e.message)) return true;
    current = e.cause ?? (typeof e.error === 'object' ? e.error : undefined);
  }
  return false;
}

/**
 * After an order that never reached the provider was cancelled (stock, wallet and
 * coupon already given back), take it out of the shopper's order history: each
 * failed try used to leave a CANCELLED / FAILED order behind. The row is soft-deleted.
 *
 * Returns the error to throw. Our own errors (AppError) pass through. Anything else
 * came from the provider call itself (outage, 5xx, or a refusal such as 401/403/429
 * from the provider or an egress proxy). The shopper can fix none of these, so they
 * all get the same clear 503 instead of a generic 500; the real cause goes to the log.
 */
export async function discardUnreachedOrder(orderId: string, error: unknown): Promise<unknown> {
  await Order.destroy({ where: { id: orderId, razorpayOrderId: null } });
  if (error instanceof AppError) return error;
  const meta = { orderId, error: describeProviderError(error) };
  if (isProviderUnreachable(error)) logger.warn('Payment provider unreachable at checkout', meta);
  else logger.error('Payment provider refused the checkout order', meta);
  return new AppError(PAYMENTS_UNAVAILABLE, 503, 'PAYMENT_PROVIDER_UNAVAILABLE');
}

function describeProviderError(error: unknown): Record<string, unknown> {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; statusCode?: unknown; error?: unknown };
  return { message: e.message, code: e.code, statusCode: e.statusCode, detail: e.error };
}
