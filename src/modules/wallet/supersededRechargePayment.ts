import { razorpay, razorpayConfigured } from '@config/razorpay';
import { logger } from '@core/logger';

/**
 * A payment captured on a wallet recharge's Razorpay order that the recharge no longer
 * points to. Retrying a failed or expired recharge gives it a new Razorpay order, so a
 * late UPI approval on the old one matched nothing: captured, never credited, never
 * refunded. Its order's notes still name the recharge; the payment is refunded (crediting
 * it could double up with the new order's payment). Returns whether it was one.
 */
export async function refundIfSupersededRechargePayment(
  razorpayOrderId: string,
  paymentId: string,
  amountPaise: number,
): Promise<boolean> {
  if (!razorpayConfigured) return false;
  let notes: Record<string, unknown>;
  try {
    const order = await razorpay.orders.fetch(razorpayOrderId);
    notes = (order.notes ?? {}) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (notes.type !== 'wallet_recharge' || typeof notes.rechargeId !== 'string') return false;

  logger.warn('Payment on a superseded wallet recharge order; refunding it', {
    rechargeId: notes.rechargeId,
    razorpayOrderId,
    paymentId,
  });
  if (amountPaise > 0) {
    const { paymentsService } = await import('@modules/payments/payments.service');
    // Throws on failure, so the webhook is retried rather than the money kept.
    await paymentsService.createRazorpayRefund(paymentId, amountPaise, {
      supersededRechargeId: notes.rechargeId,
      paymentId,
      reason: 'SUPERSEDED_RECHARGE',
    });
  }
  return true;
}
