import { razorpay, razorpayConfigured } from '@config/razorpay';
import { logger } from '@core/logger';

/** A payment as Razorpay reports it for an order (the fields the capture path reads). */
export type GatewayPayment = {
  id: string;
  order_id: string;
  status?: string;
  amount?: number;
  currency?: string;
  token_id?: string | null;
  method?: string;
  card?: { last4?: string; network?: string; type?: string } | null;
  vpa?: string | null;
};

/** What Razorpay holds for an order: its captured payment, and whether one is mid-flight. */
export type GatewayOrderState = { captured: GatewayPayment | null; authorized: boolean };

export const razorpayOrderPayments = {
  /**
   * Asks Razorpay what was paid on an order. `null` when it can't be asked (not
   * configured, or the call failed): callers then keep their old behaviour rather
   * than guess that nothing was paid.
   */
  async fetch(razorpayOrderId: string): Promise<GatewayOrderState | null> {
    if (!razorpayConfigured) return null;
    try {
      const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
      const items = (payments.items ?? []) as unknown as GatewayPayment[];
      return {
        captured: items.find((payment) => payment.status === 'captured') ?? null,
        authorized: items.some((payment) => payment.status === 'authorized'),
      };
    } catch (error) {
      logger.warn('Razorpay order payments lookup failed', {
        razorpayOrderId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
};
