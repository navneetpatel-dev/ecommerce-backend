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
import { User } from '@database/models/user.model';
import { SavedPaymentMethod } from '@database/models/savedPaymentMethod.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { cartService } from '@modules/cart/cart.service';
import {
  recordCouponUsagesForOrder,
  destroyCouponUsageForOrder,
} from '@modules/coupons/couponEngine';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  COMMISSION_STATUS,
  allSubOrdersCancellable,
} from '@core/constants/statuses';
import { ERROR_MESSAGES, ERROR_CODES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { toPaise } from '@modules/pricing/money';
import { notifyOrderConfirmed } from '@modules/notifications/orderNotifications';
import { notificationsService } from '@modules/notifications/notifications.service';
import { rollbackOrderWalletIfNeeded } from '@modules/wallet/walletOrderRollback';

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
      if (locked.paymentStatus === PAYMENT_STATUS.PAID) return;

      if (locked.status === ORDER_STATUS.CANCELLED) {
        const walletRestored = await rollbackOrderWalletIfNeeded(locked, locked.userId, t);
        if (walletRestored) {
          await locked.update({ walletAmountUsed: 0 }, { transaction: t });
        }
        cancelledOrderId = locked.id;
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

      // Defense in depth, matching checkout.service.ts's cancelPendingCheckout and
      // ordersCancel.service.ts's cancelPaidOrder: never restock/un-order a suborder that has
      // already moved past pre-shipment, even though a `payment.failed` webhook for an order
      // still PENDING payment shouldn't normally reach a shipped suborder.
      if (!allSubOrdersCancellable(order.subOrders ?? [])) return;

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

      await rollbackOrderWalletIfNeeded(order, order.userId, t);

      await order.update(
        {
          status: ORDER_STATUS.CANCELLED,
          paymentStatus: PAYMENT_STATUS.FAILED,
          walletAmountUsed: 0,
        },
        { transaction: t },
      );
      cancelledOrderId = order.id;
    });
    return cancelledOrderId;
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
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amountPaise,
      notes,
    });
    return String(refund.id);
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
  async handleRazorpayWebhook(rawBody: Buffer | string, signature: string | undefined) {
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

    const event = JSON.parse(bodyString) as {
      id: string;
      event: string;
      payload?: {
        payment?: {
          entity?: {
            id: string;
            order_id: string;
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

    if (!event?.id) {
      throw new ValidationError(ERROR_MESSAGES.INVALID_WEBHOOK_PAYLOAD);
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
        const { walletRechargeService } = await import('@modules/wallet/walletRecharge.service');
        const handledRecharge = await walletRechargeService.handlePaymentCaptured(
          payment.order_id,
          payment.id,
        );
        const { giftCardsService } = await import('@modules/giftCards/giftCards.service');
        const handledGiftCard = !handledRecharge
          ? await giftCardsService.handlePaymentCaptured(payment.order_id, payment.id)
          : false;
        if (!handledRecharge && !handledGiftCard) {
          let confirmedOrderId: string | null = null;
          let confirmedOrderUserId: string | null = null;
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
            confirmedOrderUserId = order.userId;
          });
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
    }

    if (event.event === 'refund.processed') {
      await this.handleRefundWebhook(event.payload?.refund?.entity);
    }

    return { received: true, duplicate: false };
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
      // Cancelling the last live sub-order cancels the whole order and records its
      // refund as `cancelRazorpayRefundId`; once that refund lands the order is
      // settled. Refunds for earlier partial cancellations match nothing here.
      // Either way this is never a return refund, so don't fall through to the
      // return matcher (it pairs refunds to returns by amount).
      await Order.update(
        {
          paymentStatus: PAYMENT_STATUS.REFUNDED,
          cancelRefundStatus: 'COMPLETED' as const,
        },
        {
          where: {
            id: orderId,
            status: ORDER_STATUS.CANCELLED,
            cancelRazorpayRefundId: refund.id,
          },
        },
      );
      return;
    }

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
