import { env } from '@config/env';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { GIFT_CARD_STATUS, WALLET_POINT_SOURCE } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { GiftCard } from '@database/models/giftCard.model';
import { roundMoney } from '@modules/pricing/money';
import { paymentsService } from '@modules/payments/payments.service';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import {
  GIFT_CARD_MIN_AMOUNT_INR,
  GIFT_CARD_MAX_AMOUNT_INR,
  GIFT_CARD_VALIDITY_DAYS,
} from './giftCards.constants';
import { generateGiftCardCode } from './giftCardCode';
import { sendGiftCardPurchasedEmail } from './giftCardEmail';
import type { PurchaseGiftCardRequest } from './giftCards.dto';

/** Ledger reference type for gift-card wallet credits — a plain string (WalletRef.type is untyped) to avoid touching the shared statuses.ts WALLET_REFERENCE_TYPE object. */
const GIFT_CARD_WALLET_REFERENCE_TYPE = 'GIFT_CARD';

export type GiftCardCheckoutPayload = {
  giftCardId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  checkoutConfigId?: string;
};

export class GiftCardsService {
  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateGiftCardCode();
      const existing = await GiftCard.findOne({ where: { code } });
      if (!existing) return code;
    }
    throw new AppError('Could not generate a unique gift card code', 500, ERROR_CODES.INTERNAL_ERROR);
  }

  async purchase(userId: string, data: PurchaseGiftCardRequest): Promise<GiftCardCheckoutPayload> {
    if (!razorpayConfigured || !env.RAZORPAY_KEY_ID) {
      throw new AppError(ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED, 503, ERROR_CODES.RAZORPAY_NOT_CONFIGURED);
    }

    const amount = roundMoney(data.amount);
    if (amount < GIFT_CARD_MIN_AMOUNT_INR || amount > GIFT_CARD_MAX_AMOUNT_INR) {
      throw new ValidationError(ERROR_MESSAGES.GIFT_CARD_AMOUNT_RANGE);
    }
    const amountInPaise = Math.round(amount * 100);
    if (amountInPaise < RAZORPAY_MIN_AMOUNT_PAISE) {
      throw new ValidationError(ERROR_MESSAGES.ORDER_AMOUNT_BELOW_RAZORPAY_MIN);
    }

    const code = await this.generateUniqueCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + GIFT_CARD_VALIDITY_DAYS);

    const giftCard = await GiftCard.create({
      code,
      amount,
      purchaserId: userId,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName ?? null,
      message: data.message ?? null,
      redeemedByUserId: null,
      redeemedAt: null,
      expiresAt,
      status: GIFT_CARD_STATUS.PENDING,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      createdBy: userId,
      updatedBy: userId,
      deletedBy: null,
    });

    try {
      const rzpOrder = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: giftCard.id.slice(0, 40),
        payment_capture: true,
        notes: {
          type: 'gift_card',
          giftCardId: giftCard.id,
          purchaserId: userId,
        },
        ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
          ? { checkout_config_id: env.RAZORPAY_CHECKOUT_CONFIG_ID }
          : {}),
      });

      await giftCard.update({ razorpayOrderId: rzpOrder.id, updatedBy: userId });

      return {
        giftCardId: giftCard.id,
        razorpayOrderId: rzpOrder.id,
        amount: Number(rzpOrder.amount),
        currency: rzpOrder.currency,
        keyId: env.RAZORPAY_KEY_ID,
        ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
          ? { checkoutConfigId: env.RAZORPAY_CHECKOUT_CONFIG_ID }
          : {}),
      };
    } catch (err) {
      await giftCard.update({ status: GIFT_CARD_STATUS.FAILED, updatedBy: userId });
      throw err;
    }
  }

  /** UX confirmation path — mirrors walletRecharge.verifyRecharge. Idempotent with the webhook via activateFromPayment. */
  async verifyPurchase(
    userId: string,
    input: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      giftCardId?: string;
    },
  ): Promise<{ giftCardId: string; status: string; code: string; amount: number }> {
    paymentsService.verifyPaymentSignature({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySignature: input.razorpaySignature,
    });

    const { giftCard } = await this.activateFromPayment({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      expectedUserId: userId,
      expectedGiftCardId: input.giftCardId,
    });

    return {
      giftCardId: giftCard.id,
      status: giftCard.status,
      code: giftCard.code,
      amount: Number(giftCard.amount),
    };
  }

  /** Idempotent activation — used by verifyPurchase and the Razorpay webhook. */
  private async activateFromPayment(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    expectedUserId?: string;
    expectedGiftCardId?: string;
  }): Promise<{ giftCard: GiftCard; justActivated: boolean }> {
    let justActivated = false;

    const giftCard = await sequelize.transaction(async (t) => {
      const row = await GiftCard.findOne({
        where: { razorpayOrderId: input.razorpayOrderId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!row) {
        throw new NotFoundError('Gift card order');
      }
      if (input.expectedUserId && row.purchaserId !== input.expectedUserId) {
        throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (input.expectedGiftCardId && row.id !== input.expectedGiftCardId) {
        throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (row.status === GIFT_CARD_STATUS.ACTIVE) {
        return row;
      }

      await row.update(
        {
          status: GIFT_CARD_STATUS.ACTIVE,
          razorpayPaymentId: input.razorpayPaymentId,
          updatedBy: row.purchaserId,
        },
        { transaction: t },
      );
      justActivated = true;
      return row;
    });

    if (justActivated) {
      void sendGiftCardPurchasedEmail(giftCard).catch(() => undefined);
    }

    return { giftCard, justActivated };
  }

  /** Called from the Razorpay webhook (payment.captured), mirroring walletRechargeService.handlePaymentCaptured. */
  async handlePaymentCaptured(razorpayOrderId: string, razorpayPaymentId: string): Promise<boolean> {
    const exists = await GiftCard.findOne({ where: { razorpayOrderId } });
    if (!exists) return false;
    await this.activateFromPayment({ razorpayOrderId, razorpayPaymentId });
    return true;
  }

  /** Called from the Razorpay webhook (payment.failed), mirroring walletRechargeService.handlePaymentFailed. */
  async handlePaymentFailed(razorpayOrderId: string): Promise<boolean> {
    const row = await GiftCard.findOne({ where: { razorpayOrderId } });
    if (!row || row.status !== GIFT_CARD_STATUS.PENDING) return false;
    await row.update({ status: GIFT_CARD_STATUS.FAILED, updatedBy: row.purchaserId });
    return true;
  }

  async redeem(userId: string, code: string): Promise<{ amount: number; balance: number; code: string }> {
    const normalizedCode = code.trim().toUpperCase();

    const giftCard = await sequelize.transaction(async (t) => {
      const row = await GiftCard.findOne({
        where: { code: normalizedCode },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!row) {
        throw new NotFoundError('Gift card');
      }
      if (row.status === GIFT_CARD_STATUS.REDEEMED) {
        throw new ValidationError(ERROR_MESSAGES.GIFT_CARD_ALREADY_REDEEMED);
      }
      if (row.status !== GIFT_CARD_STATUS.ACTIVE) {
        throw new ValidationError(ERROR_MESSAGES.GIFT_CARD_INVALID);
      }
      if (row.expiresAt.getTime() < Date.now()) {
        await row.update({ status: GIFT_CARD_STATUS.EXPIRED, updatedBy: userId }, { transaction: t });
        throw new ValidationError(ERROR_MESSAGES.GIFT_CARD_EXPIRED);
      }

      await walletService.credit(
        userId,
        Number(row.amount),
        { type: GIFT_CARD_WALLET_REFERENCE_TYPE, id: row.id },
        `${WALLET_DESCRIPTIONS.GIFT_CARD_REDEMPTION} #${row.code}`,
        t,
        { pointSource: WALLET_POINT_SOURCE.PURCHASED },
      );

      await row.update(
        {
          status: GIFT_CARD_STATUS.REDEEMED,
          redeemedByUserId: userId,
          redeemedAt: new Date(),
          updatedBy: userId,
        },
        { transaction: t },
      );

      return row;
    });

    const balance = await walletService.getBalance(userId);
    return { amount: Number(giftCard.amount), balance, code: giftCard.code };
  }

  /** Public — landing page preview before login. No purchaser/recipient PII. */
  async getPublicByCode(code: string): Promise<{ amount: number; status: string; expiresAt: Date }> {
    const giftCard = await GiftCard.findOne({ where: { code: code.trim().toUpperCase() } });
    if (!giftCard) {
      throw new NotFoundError('Gift card');
    }
    return {
      amount: Number(giftCard.amount),
      status: giftCard.status,
      expiresAt: giftCard.expiresAt,
    };
  }
}

export const giftCardsService = new GiftCardsService();
