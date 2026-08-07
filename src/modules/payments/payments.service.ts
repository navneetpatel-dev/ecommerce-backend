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
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Coupon } from '@database/models/coupon.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { cartService } from '@modules/cart/cart.service';
import {
  recordCouponUsage,
  creditCashbackIfNeeded,
  destroyCouponUsageForOrder,
} from '@modules/coupons/couponEngine';
import { ORDER_STATUS, PAYMENT_STATUS, COMMISSION_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES, ERROR_CODES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { notifyOrderConfirmed } from '@modules/notifications/orderNotifications';
import { notificationsService } from '@modules/notifications/notifications.service';

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
  private async restoreCancelledRazorpayOrder(razorpayOrderId: string): Promise<string | null> {
    let cancelledOrderId: string | null = null;
    await sequelize.transaction(async (t) => {
      const locked = await Order.findOne({
        where: { razorpayOrderId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!locked) return;
      if (locked.status === ORDER_STATUS.CANCELLED || locked.paymentStatus === PAYMENT_STATUS.PAID) {
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
      const restoreLines: Array<{ variantId: string; quantity: number }> = [];

      for (const subOrder of order.subOrders ?? []) {
        for (const item of subOrder.items ?? []) {
          restoreLines.push({ variantId: item.variantId, quantity: item.quantity });
          await ProductVariant.increment('stock', {
            by: item.quantity,
            where: { id: item.variantId },
            transaction: t,
          });
        }

        await subOrder.update({ status: ORDER_STATUS.CANCELLED }, { transaction: t });
        await CommissionLedger.destroy({
          where: { subOrderId: subOrder.id, status: COMMISSION_STATUS.PENDING },
          transaction: t,
        });
      }

      await destroyCouponUsageForOrder(order.id, t);

      await cartService.restoreItemsToUserCart(order.userId, restoreLines, t);

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
        },
        { transaction: t },
      );
      cancelledOrderId = order.id;
    });
    return cancelledOrderId;
  }

  private async applyCouponOnPaymentCaptured(order: Order, transaction: any) {
    if (!order.couponId) return;
    const coupon = await Coupon.findByPk(order.couponId, { transaction });
    if (!coupon) return;

    await recordCouponUsage({
      couponId: coupon.id,
      userId: order.userId,
      orderId: order.id,
      discountApplied: Number(order.discountTotal ?? 0),
      actorId: order.userId,
      transaction,
    });

    if (coupon.type === 'CASHBACK') {
      const cashback = Number(coupon.value ?? 0);
      const amount = Math.min(cashback, Number(order.totalAmount) + Number(order.discountTotal ?? 0));
      await creditCashbackIfNeeded({
        coupon,
        userId: order.userId,
        orderId: order.id,
        cashbackAmount: amount,
        transaction,
      });
    }
  }

  async createRazorpayOrderForOrder(order: Order): Promise<RazorpayCheckoutPayload> {
    if (!razorpayConfigured || !env.RAZORPAY_KEY_ID) {
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }

    const amountInPaise = Math.round(Number(order.totalAmount) * 100);
    if (amountInPaise < RAZORPAY_MIN_AMOUNT_PAISE) {
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
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
      .digest('hex');

    if (!safeTimingEqual(expected, input.razorpaySignature)) {
      throw new AppError('Signature mismatch', 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    return { verified: true };
  }

  /**
   * Authoritative payment confirmation. Idempotent via WebhookEvent dedup.
   */
  async handleRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new AppError('Razorpay webhook secret is not configured', 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }
    if (!signature) {
      throw new AppError('Missing webhook signature', 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(bodyString)
      .digest('hex');

    if (!safeTimingEqual(expected, signature)) {
      throw new AppError('Invalid signature', 400, ERROR_CODES.INVALID_SIGNATURE);
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

    if (!created) {
      return { received: true, duplicate: true };
    }

    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        let confirmedOrderId: string | null = null;
        await sequelize.transaction(async (t) => {
          const order = await Order.findOne({
            where: { razorpayOrderId: payment.order_id },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (!order) return;
          if (order.paymentStatus === PAYMENT_STATUS.PAID) return;

          await order.update(
            {
              paymentStatus: PAYMENT_STATUS.PAID,
              razorpayPaymentId: payment.id,
              status: ORDER_STATUS.CONFIRMED,
            },
            { transaction: t },
          );
          await this.applyCouponOnPaymentCaptured(order, t);
          confirmedOrderId = order.id;
        });
        if (confirmedOrderId) {
          void notifyOrderConfirmed(confirmedOrderId);
        }
      }
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        const order = await Order.findOne({ where: { razorpayOrderId: payment.order_id } });
        if (order) {
          void notificationsService.sendPaymentFailed(order.userId, order.id, {
            orderId: order.id,
            orderNumber: order.id.slice(0, 8).toUpperCase(),
          });
        }
        const cancelledOrderId = await this.restoreCancelledRazorpayOrder(payment.order_id);
        if (cancelledOrderId && order) {
          void notificationsService.sendOrderCancelled(order.userId, cancelledOrderId, {
            orderId: cancelledOrderId,
            orderNumber: cancelledOrderId.slice(0, 8).toUpperCase(),
          });
        }
      }
    }

    return { received: true, duplicate: false };
  }
}

export const paymentsService = new PaymentsService();
