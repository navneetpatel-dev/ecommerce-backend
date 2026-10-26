import crypto from 'crypto';
import { razorpayWebhookEventId } from './razorpayWebhookEventId';
import { createIdempotentRazorpayRefund } from './razorpayRefund';
import type { GatewayPayment } from './razorpayOrderPayments';
import { env } from '@config/env';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { Coupon } from '@database/models/coupon.model';
import { WebhookEvent } from '@database/models/webhookEvent.model';
import { User } from '@database/models/user.model';
import { SavedPaymentMethod } from '@database/models/savedPaymentMethod.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { recordCouponUsagesForOrder } from '@modules/coupons/couponEngine';
import { ORDER_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { ERROR_MESSAGES, ERROR_CODES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { toPaise } from '@modules/pricing/money';
import { checkoutAmountDue } from '@modules/pricing/displayMoney';
import { notifyOrderConfirmed } from '@modules/notifications/orderNotifications';
import { notificationsService } from '@modules/notifications/notifications.service';
import { markPartCardRefundProcessed } from './partCardRefund';
import { failedOrderRefundAttempt } from './orderCancelRefund';
import { refundIfSupersededRechargePayment } from '@modules/wallet/supersededRechargePayment';

export type RazorpayCheckoutPayload = {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  checkoutConfigId?: string;
  /**
   * Razorpay Customer ID for this shopper, when available. The frontend
   * passes this through to Razorpay Checkout's `customer_id` option so
   * Checkout's own UI can offer saved cards/UPI for return customers —
   * this is a Checkout-side behavior, not something built here.
   */
  razorpayCustomerId?: string;
};

function safeTimingEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * The Razorpay order was created for exactly what the order owes (its total less the
 * wallet share), in rupees: a capture for anything else is not this order's payment.
 * A payload without an amount (older events) is taken as before.
 */
function capturedMatchesOrder(order: Order, payment: GatewayPayment): boolean {
  if (payment.currency && payment.currency !== 'INR') return false;
  if (payment.amount == null) return true;
  return Number(payment.amount) === toPaise(checkoutAmountDue(order.totalAmount, order.walletAmountUsed));
}

type RazorpayWebhookEvent = {
  id?: string;
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        /** Captured amount, in paise. */
        amount?: number;
        currency?: string;
        /** Present when the customer opted to save this instrument. */
        token_id?: string | null;
        method?: string;
        card?: { last4?: string; network?: string; type?: string } | null;
        vpa?: string | null;
      };
    };
    refund?: {
      entity?: {
        id: string;
        payment_id: string;
        amount: number;
        status?: string;
        notes?: Record<string, string> | null;
      };
    };
  };
};

export class PaymentsService {
  /**
   * Confirms the order a captured Razorpay payment pays for: from the payment.captured
   * webhook, or from the expiry job when that webhook never came. Safe to repeat for a
   * payment. A capture on an order cancelled unpaid is refunded, and so is a second
   * capture on an order another payment already paid (two attempts both went through).
   */
  async confirmCapturedPayment(payment: GatewayPayment): Promise<void> {
    let confirmedOrderId: string | null = null;
    let confirmedOrderUserId: string | null = null;
    let cancelledPaidOrder: Order | null = null;
    let doublePaidOrderId: string | null = null;
    let mismatchedOrderId: string | null = null;
    await sequelize.transaction(async (t) => {
      const order = await Order.findOne({
        where: { razorpayOrderId: payment.order_id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!order) return;
      if (order.paymentStatus === PAYMENT_STATUS.PAID) {
        if (order.razorpayPaymentId !== payment.id) doublePaidOrderId = order.id;
        return;
      }
      // Never revive a cancelled order: its stock and wallet money are already back.
      if (order.status === ORDER_STATUS.CANCELLED) {
        cancelledPaidOrder = order;
        return;
      }
      if (!capturedMatchesOrder(order, payment)) {
        mismatchedOrderId = order.id;
        return;
      }

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
      confirmedOrderUserId = order.userId;
    });
    if (cancelledPaidOrder) {
      await this.refundPaymentForCancelledOrder(cancelledPaidOrder, payment.id, Number(payment.amount ?? 0));
    }
    if (mismatchedOrderId) {
      // Not what the order owes: never confirm on it. Refunded; the order stays unpaid
      // and expires like any unpaid checkout. Throws on failure, so the webhook retries.
      logger.error('Captured payment does not match the order amount; refunding it', {
        orderId: mismatchedOrderId,
        paymentId: payment.id,
        amountPaise: payment.amount,
        currency: payment.currency,
      });
      if (Number(payment.amount ?? 0) > 0) {
        await this.createRazorpayRefund(payment.id, Number(payment.amount), {
          orderId: mismatchedOrderId,
          paymentId: payment.id,
          reason: 'AMOUNT_MISMATCH',
        });
      }
    }
    if (doublePaidOrderId && Number(payment.amount ?? 0) > 0) {
      // Throws on failure, so the webhook is retried rather than the money kept.
      logger.warn('Second captured payment on a paid order; refunding it', {
        orderId: doublePaidOrderId,
        paymentId: payment.id,
      });
      await this.createRazorpayRefund(payment.id, Number(payment.amount), {
        orderId: doublePaidOrderId,
        paymentId: payment.id,
        reason: 'DUPLICATE_PAYMENT',
      });
    }
    if (confirmedOrderId) {
      void notifyOrderConfirmed(confirmedOrderId);
    }
    if (confirmedOrderUserId && payment.token_id) {
      const buyer = await User.findByPk(confirmedOrderUserId);
      void this.persistSavedMethodFromPayment(confirmedOrderUserId, buyer?.razorpayCustomerId, {
        token_id: payment.token_id,
        method: payment.method,
        card: payment.card,
        vpa: payment.vpa,
      });
    }
  }

  /**
   * A payment captured for an order already cancelled unpaid (expired, dismissed, or a
   * failed attempt followed by a successful retry): the goods went back to stock and the
   * wallet was returned, so the card money goes straight back as well.
   */
  private async refundPaymentForCancelledOrder(
    order: Order,
    paymentId: string,
    amountPaise: number,
  ): Promise<void> {
    await order.update({
      razorpayPaymentId: paymentId,
      cancelRefundStatus: REFUND_STATUS.PENDING,
      cancelRefundAmountPaise: amountPaise > 0 ? amountPaise : null,
    });
    if (amountPaise <= 0) return;
    try {
      const refundId = await this.createRazorpayRefund(paymentId, amountPaise, {
        orderId: order.id,
        reason: 'ORDER_CANCEL',
      });
      await order.update({
        paymentStatus: PAYMENT_STATUS.PAID,
        cancelRefundStatus: REFUND_STATUS.INITIATED,
        cancelRazorpayRefundId: refundId,
        cancelRefundAmountPaise: amountPaise,
      });
    } catch (error) {
      logger.error('Refund of payment on a cancelled order failed', {
        orderId: order.id,
        paymentId,
        reason: error instanceof Error ? error.message : String(error),
      });
      await order.update({
        ...failedOrderRefundAttempt(),
        paymentStatus: PAYMENT_STATUS.PAID,
        cancelRefundAmountPaise: amountPaise,
      });
    }
  }

  private async applyCouponOnPaymentCaptured(order: Order, transaction: any) {
    const couponIds = [
      ...new Set(
        [
          ...(Array.isArray(order.appliedCouponIds) ? order.appliedCouponIds : []),
          order.couponId,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (couponIds.length === 0) return;

    const coupons = await Coupon.findAll({
      where: { id: couponIds },
      transaction,
    });
    if (coupons.length === 0) return;

    await recordCouponUsagesForOrder({
      coupons,
      breakdown: Array.isArray(order.appliedCouponBreakdown)
        ? order.appliedCouponBreakdown
        : [],
      discountTotal: Number(order.discountTotal ?? 0),
      userId: order.userId,
      orderId: order.id,
      actorId: order.userId,
      transaction,
    });
  }

  /**
   * Returns the shopper's Razorpay customer id, creating one via the
   * Razorpay SDK on first use and caching it on `User.razorpayCustomerId`.
   * Best-effort: a failure here (e.g. sandbox quirks, duplicate-customer
   * errors) must never block checkout, so it swallows errors and returns
   * null — the order is then created without customer context.
   */
  private async getOrCreateCustomerId(userId: string): Promise<string | null> {
    const user = await User.findByPk(userId);
    if (!user) return null;
    if (user.razorpayCustomerId) return user.razorpayCustomerId;

    try {
      const customer = await razorpay.customers.create({
        name: user.name,
        email: user.email,
        ...(user.phone ? { contact: user.phone } : {}),
        // Fetch the existing customer instead of throwing if Razorpay
        // already has one for this email/contact combination.
        fail_existing: 0,
      });
      await user.update({ razorpayCustomerId: customer.id });
      return customer.id;
    } catch {
      return null;
    }
  }

  async createRazorpayOrderForOrder(
    order: Order,
    amountOverrideRupees?: number,
  ): Promise<RazorpayCheckoutPayload> {
    if (!razorpayConfigured || !env.RAZORPAY_KEY_ID) {
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }

    const chargeAmount =
      amountOverrideRupees != null ? Number(amountOverrideRupees) : Number(order.totalAmount);
    const amountInPaise = toPaise(chargeAmount);
    if (amountInPaise < RAZORPAY_MIN_AMOUNT_PAISE) {
      throw new ValidationError(ERROR_MESSAGES.ORDER_AMOUNT_BELOW_RAZORPAY_MIN);
    }

    const customerId = await this.getOrCreateCustomerId(order.userId);

    // `customer_id` isn't in this SDK version's Orders typings (it's
    // documented for the Authorization-order flow), but Razorpay's REST
    // API accepts it on regular orders to associate them with a customer
    // for saved-instrument context — pass it defensively via a loose cast.
    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.id,
      payment_capture: true,
      ...(customerId ? { customer_id: customerId } : {}),
      ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
        ? { checkout_config_id: env.RAZORPAY_CHECKOUT_CONFIG_ID }
        : {}),
    } as Parameters<typeof razorpay.orders.create>[0]);

    await order.update({ razorpayOrderId: rzpOrder.id });

    return {
      razorpayOrderId: rzpOrder.id,
      amount: Number(rzpOrder.amount),
      currency: rzpOrder.currency,
      keyId: env.RAZORPAY_KEY_ID,
      ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
        ? { checkoutConfigId: env.RAZORPAY_CHECKOUT_CONFIG_ID }
        : {}),
      ...(customerId ? { razorpayCustomerId: customerId } : {}),
    };
  }

  /**
   * List a shopper's saved cards/UPI instruments, newest first.
   */
  async listSavedMethods(userId: string): Promise<SavedPaymentMethod[]> {
    return SavedPaymentMethod.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Remove a saved instrument. Best-effort invalidates the token on
   * Razorpay's side too (`customers.deleteToken`) — if that call fails
   * (e.g. already removed, sandbox limitation) the local record is still
   * deleted so it stops showing up, but the token may persist Razorpay-side
   * until it naturally expires.
   */
  async deleteSavedMethod(userId: string, id: string): Promise<void> {
    const record = await SavedPaymentMethod.findByPk(id);
    if (!record || record.userId !== userId) {
      throw new NotFoundError('Saved payment method');
    }

    if (razorpayConfigured) {
      try {
        await razorpay.customers.deleteToken(record.razorpayCustomerId, record.razorpayTokenId);
      } catch {
        // Non-fatal — see method doc. Local record is removed regardless.
      }
    }

    await record.destroy();
  }

  /**
   * Best-effort capture of a newly-saved card/UPI token from a
   * `payment.captured` webhook payload. Razorpay's standard webhook
   * catalog has no dedicated `token.created` event; the payment entity
   * itself carries `token_id` (plus `card`/`vpa`/`method`) whenever the
   * customer opted to save the instrument during Checkout, so that's the
   * hook point used here. This is the best documented signal available
   * without live sandbox verification against a real saved-card flow —
   * treat as a follow-up item to confirm once tested end-to-end.
   */
  private async persistSavedMethodFromPayment(
    userId: string,
    customerId: string | null | undefined,
    payment: {
      token_id?: string | null;
      method?: string;
      card?: { last4?: string; network?: string; type?: string } | null;
      vpa?: string | null;
    },
  ): Promise<void> {
    if (!payment.token_id || !customerId) return;

    await SavedPaymentMethod.findOrCreate({
      where: { razorpayTokenId: payment.token_id },
      defaults: {
        userId,
        razorpayCustomerId: customerId,
        razorpayTokenId: payment.token_id,
        methodType: payment.method ?? 'unknown',
        cardLast4: payment.card?.last4 ?? null,
        cardNetwork: payment.card?.network ?? null,
        vpa: payment.vpa ?? null,
        metadata: { card: payment.card ?? null, method: payment.method ?? null },
      },
    });
  }

  /**
   * Initiate a Razorpay refund. Does NOT mark the return REFUNDED —
   * wait for refund.processed webhook.
   */
  async createRazorpayRefund(
    paymentId: string,
    amountPaise: number,
    notes: Record<string, string>,
  ): Promise<string> {
    if (!razorpayConfigured) {
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }
    return createIdempotentRazorpayRefund(paymentId, amountPaise, notes);
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
      throw new AppError(ERROR_MESSAGES.INVALID_SIGNATURE, 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    return { verified: true };
  }

  /**
   * Authoritative payment confirmation. Idempotent via WebhookEvent dedup.
   */
  async handleRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined, suppliedEventId?: string) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }
    if (!signature) {
      throw new AppError(ERROR_MESSAGES.INVALID_SIGNATURE, 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(bodyString)
      .digest('hex');

    if (!safeTimingEqual(expected, signature)) {
      throw new AppError(ERROR_MESSAGES.INVALID_SIGNATURE, 400, ERROR_CODES.INVALID_SIGNATURE);
    }

    const event = JSON.parse(bodyString) as RazorpayWebhookEvent;

    const eventId = razorpayWebhookEventId(event, bodyString, suppliedEventId);

    const [, created] = await WebhookEvent.findOrCreate({
      where: { provider: 'razorpay', eventId },
      defaults: { provider: 'razorpay', eventId, payload: event as unknown as Record<string, unknown> },
    });

    if (!created) {
      return { received: true, duplicate: true };
    }

    try {
      await this.processRazorpayEvent(event);
    } catch (error) {
      // Not processed after all: forget the event, so Razorpay's retry (it retries on a
      // non-2xx) runs it again instead of being answered "duplicate". Each step is safe
      // to repeat.
      await WebhookEvent.destroy({ where: { provider: 'razorpay', eventId }, force: true });
      throw error;
    }
    return { received: true, duplicate: false };
  }

  private async processRazorpayEvent(event: RazorpayWebhookEvent): Promise<void> {
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        const { walletRechargeService } = await import('@modules/wallet/walletRecharge.service');
        const handledRecharge =
          (await walletRechargeService.handlePaymentCaptured(payment.order_id, payment.id)) ||
          (await refundIfSupersededRechargePayment(payment.order_id, payment.id, Number(payment.amount ?? 0)));
        const { giftCardsService } = await import('@modules/giftCards/giftCards.service');
        const handledGiftCard = !handledRecharge
          ? await giftCardsService.handlePaymentCaptured(payment.order_id, payment.id)
          : false;
        if (!handledRecharge && !handledGiftCard) {
          await this.confirmCapturedPayment(payment);
        }
      }
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        const { walletRechargeService } = await import('@modules/wallet/walletRecharge.service');
        const handledRecharge = await walletRechargeService.handlePaymentFailed(payment.order_id);
        const { giftCardsService } = await import('@modules/giftCards/giftCards.service');
        const handledGiftCard = !handledRecharge
          ? await giftCardsService.handlePaymentFailed(payment.order_id)
          : false;
        if (!handledRecharge && !handledGiftCard) {
          // One failed attempt: Razorpay's checkout stays open for a retry on the same
          // order, so it is not cancelled here. A checkout abandoned for good is cancelled
          // by the customer closing it, or by the expiry job after its payment window.
          const order = await Order.findOne({ where: { razorpayOrderId: payment.order_id } });
          if (order) {
            void notificationsService.sendPaymentFailed(order.userId, order.id, {
              orderId: order.id,
              orderNumber: order.id.slice(0, 8).toUpperCase(),
            });
          }
        }
      }
    }

    if (event.event === 'refund.processed') {
      await this.handleRefundWebhook(event.payload?.refund?.entity);
    }
  }

  private async handleRefundWebhook(
    refund:
      | {
          id: string;
          payment_id: string;
          amount: number;
          status?: string;
          notes?: Record<string, string> | null;
        }
      | undefined,
  ): Promise<void> {
    if (!refund?.id || !refund.payment_id) return;
    // Only `refund.processed` flips status — never on create alone.
    if (refund.status && refund.status !== 'processed') return;

    const notes = refund.notes ?? {};
    const rechargeId = typeof notes.rechargeId === 'string' ? notes.rechargeId : null;
    if (rechargeId) {
      const { walletRechargeService } = await import('@modules/wallet/walletRecharge.service');
      await walletRechargeService.markRazorpayRefundProcessed({
        razorpayRefundId: refund.id,
        rechargeId,
      });
      return;
    }

    const orderId = typeof notes.orderId === 'string' ? notes.orderId : null;
    if (orderId && notes.reason === 'ORDER_CANCEL') {
      await Order.update(
        {
          paymentStatus: PAYMENT_STATUS.REFUNDED,
          cancelRefundStatus: 'COMPLETED' as const,
          cancelRazorpayRefundId: refund.id,
        },
        { where: { id: orderId } },
      );
      return;
    }

    if (orderId && notes.reason === 'SUBORDER_CANCEL') {
      // A reversed part's refund (cancelled, or RTO'd). The part records it; the order
      // is settled once every part's refund has landed. Never a return refund, so don't
      // fall through to the return matcher (it pairs refunds to returns by amount).
      const subOrderId = typeof notes.subOrderId === 'string' ? notes.subOrderId : null;
      if (subOrderId) {
        await markPartCardRefundProcessed({ orderId, subOrderId, refundId: refund.id });
      }
      return;
    }

    // A second payment, or one on a superseded recharge order, refunded in full: no
    // order, return or recharge records it.
    if (['DUPLICATE_PAYMENT', 'SUPERSEDED_RECHARGE', 'AMOUNT_MISMATCH'].includes(String(notes.reason))) return;

    const returnRequestId =
      typeof notes.returnRequestId === 'string' ? notes.returnRequestId : null;

    const { returnsService } = await import('@modules/returns/returns.service');
    await returnsService.markRazorpayRefundProcessed({
      razorpayRefundId: refund.id,
      paymentId: refund.payment_id,
      amountPaise: Number(refund.amount ?? 0),
      returnRequestId,
    });
  }
}

export const paymentsService = new PaymentsService();
