import crypto from 'crypto';
import { env } from '@config/env';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { CartItem } from '@database/models/cartItem.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { cartRepository } from '@modules/cart/cart.repository';

export type RazorpayCheckoutPayload = {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

function safeTimingEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

type OrderForRollback = Order & {
  subOrders?: (SubOrder & { items?: OrderItem[] })[];
};

export class PaymentsService {
  private async restoreCancelledRazorpayOrder(razorpayOrderId: string) {
    await sequelize.transaction(async (t) => {
      const locked = await Order.findOne({
        where: { razorpayOrderId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!locked) return;
      if (locked.status === 'CANCELLED' || locked.paymentStatus === 'PAID') {
        return;
      }

      const orderResult = await Order.findByPk(locked.id, {
        include: [
          {
            model: SubOrder,
            as: 'subOrders',
            include: [{ model: OrderItem, as: 'items' }],
          },
        ],
        transaction: t,
      });

      if (!orderResult) return;

      const order = orderResult as OrderForRollback;
      const cart = await cartRepository.findOrCreateByUser(order.userId);

      for (const subOrder of order.subOrders ?? []) {
        for (const item of subOrder.items ?? []) {
          const variant = await ProductVariant.findByPk(item.variantId, { transaction: t });
          if (variant) {
            await variant.increment('stock', {
              by: item.quantity,
              transaction: t,
            });
          }

          const existing = await CartItem.findOne({
            where: { cartId: cart.id, variantId: item.variantId },
            transaction: t,
          });

          if (existing) {
            await existing.update(
              { quantity: existing.quantity + item.quantity },
              { transaction: t },
            );
          } else {
            await CartItem.create(
              {
                cartId: cart.id,
                variantId: item.variantId,
                quantity: item.quantity,
              },
              { transaction: t },
            );
          }
        }

        await subOrder.update({ status: 'CANCELLED' }, { transaction: t });
        await CommissionLedger.destroy({
          where: { subOrderId: subOrder.id, status: 'PENDING' },
          transaction: t,
        });
      }

      await order.update(
        {
          status: 'CANCELLED',
          paymentStatus: 'FAILED',
        },
        { transaction: t },
      );
    });
  }

  async createRazorpayOrderForOrder(order: Order): Promise<RazorpayCheckoutPayload> {
    if (!razorpayConfigured || !env.RAZORPAY_KEY_ID) {
      throw new AppError('Razorpay is not configured', 503, 'RAZORPAY_NOT_CONFIGURED');
    }

    // Amount always from the Order row — never from the client
    const amountInPaise = Math.round(Number(order.totalAmount) * 100);
    if (amountInPaise < 100) {
      throw new ValidationError('Order amount below Razorpay minimum');
    }

    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.id,
    });

    await order.update({ razorpayOrderId: rzpOrder.id });

    return {
      razorpayOrderId: rzpOrder.id,
      amount: Number(rzpOrder.amount),
      currency: rzpOrder.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * Client-callback signature check — UX confirmation only.
   * Does NOT mark the order paid; the webhook is authoritative.
   */
  verifyPaymentSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): { verified: true } {
    if (!env.RAZORPAY_KEY_SECRET) {
      throw new AppError('Razorpay is not configured', 503, 'RAZORPAY_NOT_CONFIGURED');
    }

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
      .digest('hex');

    if (!safeTimingEqual(expected, input.razorpaySignature)) {
      throw new AppError('Signature mismatch', 400, 'INVALID_SIGNATURE');
    }

    return { verified: true };
  }

  /**
   * Authoritative payment confirmation. Idempotent via WebhookEvent dedup.
   */
  async handleRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new AppError('Razorpay webhook secret is not configured', 503, 'RAZORPAY_NOT_CONFIGURED');
    }
    if (!signature) {
      throw new AppError('Missing webhook signature', 400, 'INVALID_SIGNATURE');
    }

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(bodyString)
      .digest('hex');

    if (!safeTimingEqual(expected, signature)) {
      throw new AppError('Invalid signature', 400, 'INVALID_SIGNATURE');
    }

    const event = JSON.parse(bodyString) as {
      id: string;
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string } } };
    };

    if (!event?.id) {
      throw new ValidationError('Invalid webhook payload');
    }

    const [, created] = await WebhookEvent.findOrCreate({
      where: { provider: 'razorpay', eventId: event.id },
      defaults: { provider: 'razorpay', eventId: event.id, payload: event as unknown as Record<string, unknown> },
    });

    // Already processed — acknowledge without re-applying side effects
    if (!created) {
      return { received: true, duplicate: true };
    }

    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        await Order.update(
          { paymentStatus: 'PAID', razorpayPaymentId: payment.id, status: 'CONFIRMED' },
          { where: { razorpayOrderId: payment.order_id } },
        );
        // ORDER_CONFIRMATION notification can be queued here when notifications are wired
      }
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        await this.restoreCancelledRazorpayOrder(payment.order_id);
      }
    }

    return { received: true, duplicate: false };
  }
}

export const paymentsService = new PaymentsService();
