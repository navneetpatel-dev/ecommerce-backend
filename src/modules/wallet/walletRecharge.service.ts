import { env } from '@config/env';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import {
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { settingsService } from '@modules/settings/settings.service';
import { roundMoney } from '@modules/pricing/money';
import { paymentsService } from '@modules/payments/payments.service';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';

export type WalletRechargeCheckoutPayload = {
  rechargeId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  pointsToCredit: number;
  checkoutConfigId?: string;
};

export class WalletRechargeService {
  async getRechargeLimits() {
    const settings = await settingsService.getPlatformSettings();
    return {
      rechargeEnabled: settings.walletRechargeEnabled,
      minInr: settings.walletMinRechargeInr,
      maxInr: settings.walletMaxRechargeInr,
      maxBalance: settings.walletMaxBalancePoints,
      presetsInr: settings.walletRechargePresetsInr,
      pointsPerRupee: settings.pointsPerRupee,
    };
  }

  private async validateRechargeAmount(userId: string, amountInr: number) {
    const settings = await settingsService.getPlatformSettings();
    if (!settings.walletRechargeEnabled) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_DISABLED);
    }
    const amount = roundMoney(amountInr);
    if (amount < settings.walletMinRechargeInr) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_BELOW_MIN);
    }
    if (amount > settings.walletMaxRechargeInr) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_ABOVE_MAX);
    }
    const pointsToCredit = roundMoney(amount * settings.pointsPerRupee);
    const balance = await walletService.getBalance(userId);
    if (balance + pointsToCredit > settings.walletMaxBalancePoints) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED);
    }
    return { amount, pointsToCredit, settings };
  }

  async createRecharge(
    userId: string,
    amountInr: number,
    idempotencyKey?: string,
  ): Promise<WalletRechargeCheckoutPayload> {
    if (!razorpayConfigured || !env.RAZORPAY_KEY_ID) {
      throw new AppError(
        ERROR_MESSAGES.RAZORPAY_NOT_CONFIGURED,
        503,
        ERROR_CODES.RAZORPAY_NOT_CONFIGURED,
      );
    }

    const { amount, pointsToCredit } = await this.validateRechargeAmount(userId, amountInr);

    if (idempotencyKey) {
      const existing = await WalletRechargeOrder.findOne({
        where: { userId, idempotencyKey },
      });
      if (existing?.razorpayOrderId && existing.status === 'PENDING') {
        const existingAmount = Number(existing.amountInr);
        return {
          rechargeId: existing.id,
          razorpayOrderId: existing.razorpayOrderId,
          amount: Math.round(existingAmount * 100),
          currency: 'INR',
          keyId: env.RAZORPAY_KEY_ID,
          pointsToCredit: Number(existing.pointsCredited),
          ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
            ? { checkoutConfigId: env.RAZORPAY_CHECKOUT_CONFIG_ID }
            : {}),
        };
      }
      if (existing?.status === 'PAID') {
        throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_ALREADY_PAID);
      }
      if (existing && (existing.status === 'FAILED' || existing.status === 'EXPIRED')) {
        await existing.update({
          amountInr: amount,
          pointsCredited: pointsToCredit,
          status: 'PENDING',
          razorpayOrderId: null,
          razorpayPaymentId: null,
          creditedLedgerId: null,
          paidAt: null,
          updatedBy: userId,
        });
        const amountInPaise = Math.round(amount * 100);
        const rzpOrder = await razorpay.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: existing.id.slice(0, 40),
          payment_capture: true,
          notes: {
            type: 'wallet_recharge',
            rechargeId: existing.id,
            userId,
          },
          ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
            ? { checkout_config_id: env.RAZORPAY_CHECKOUT_CONFIG_ID }
            : {}),
        });
        await existing.update({
          razorpayOrderId: rzpOrder.id,
          updatedBy: userId,
        });
        return {
          rechargeId: existing.id,
          razorpayOrderId: rzpOrder.id,
          amount: Number(rzpOrder.amount),
          currency: rzpOrder.currency,
          keyId: env.RAZORPAY_KEY_ID,
          pointsToCredit,
          ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
            ? { checkoutConfigId: env.RAZORPAY_CHECKOUT_CONFIG_ID }
            : {}),
        };
      }
    }

    const amountInPaise = Math.round(amount * 100);
    if (amountInPaise < RAZORPAY_MIN_AMOUNT_PAISE) {
      throw new ValidationError('Recharge amount below Razorpay minimum');
    }

    const recharge = await WalletRechargeOrder.create({
      userId,
      amountInr: amount,
      pointsCredited: pointsToCredit,
      status: 'PENDING',
      idempotencyKey: idempotencyKey ?? null,
      createdBy: userId,
      updatedBy: userId,
      deletedBy: null,
    });

    const rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: recharge.id.slice(0, 40),
      payment_capture: true,
      notes: {
        type: 'wallet_recharge',
        rechargeId: recharge.id,
        userId,
      },
      ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
        ? { checkout_config_id: env.RAZORPAY_CHECKOUT_CONFIG_ID }
        : {}),
    });

    await recharge.update({
      razorpayOrderId: rzpOrder.id,
      updatedBy: userId,
    });

    return {
      rechargeId: recharge.id,
      razorpayOrderId: rzpOrder.id,
      amount: Number(rzpOrder.amount),
      currency: rzpOrder.currency,
      keyId: env.RAZORPAY_KEY_ID,
      pointsToCredit,
      ...(env.RAZORPAY_CHECKOUT_CONFIG_ID
        ? { checkoutConfigId: env.RAZORPAY_CHECKOUT_CONFIG_ID }
        : {}),
    };
  }

  async getRecharge(
    userId: string,
    rechargeId: string,
  ): Promise<{
    id: string;
    status: string;
    amountInr: number;
    pointsCredited: number;
    paidAt: Date | null;
  }> {
    const row = await WalletRechargeOrder.findByPk(rechargeId);
    if (!row || row.userId !== userId) {
      throw new NotFoundError('WalletRechargeOrder');
    }
    return {
      id: row.id,
      status: String(row.status),
      amountInr: Number(row.amountInr),
      pointsCredited: Number(row.pointsCredited),
      paidAt: row.paidAt,
    };
  }

  async verifyRecharge(
    userId: string,
    input: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      rechargeId?: string;
    },
  ): Promise<{
    rechargeId: string;
    status: string;
    pointsCredited: number;
    balance: number;
  }> {
    paymentsService.verifyPaymentSignature({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySignature: input.razorpaySignature,
    });

    const credited = await this.creditFromPayment({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      expectedUserId: userId,
      expectedRechargeId: input.rechargeId,
    });

    return {
      rechargeId: credited.id,
      status: String(credited.status),
      pointsCredited: Number(credited.pointsCredited),
      balance: await walletService.getBalance(userId),
    };
  }

  /** Idempotent credit — used by verify endpoint and Razorpay webhook. */
  private async creditFromPayment(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    expectedUserId?: string;
    expectedRechargeId?: string;
  }): Promise<WalletRechargeOrder> {
    return sequelize.transaction(async (transaction) => {
      const recharge = await WalletRechargeOrder.findOne({
        where: { razorpayOrderId: input.razorpayOrderId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!recharge) {
        throw new NotFoundError('WalletRechargeOrder');
      }
      if (input.expectedUserId && recharge.userId !== input.expectedUserId) {
        throw new ValidationError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (input.expectedRechargeId && recharge.id !== input.expectedRechargeId) {
        throw new ValidationError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (recharge.status === 'PAID' && recharge.creditedLedgerId) {
        return recharge;
      }

      const settings = await settingsService.getPlatformSettings();
      const balance = await walletService.getBalance(recharge.userId, transaction);
      const points = Number(recharge.pointsCredited);
      if (balance + points > settings.walletMaxBalancePoints) {
        await recharge.update(
          { status: 'FAILED', updatedBy: recharge.userId },
          { transaction },
        );
        throw new ValidationError(ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED);
      }

      const ledger = await walletService.credit(
        recharge.userId,
        points,
        { type: WALLET_REFERENCE_TYPE.TOPUP, id: recharge.id },
        WALLET_DESCRIPTIONS.TOPUP_CREDIT,
        transaction,
        { pointSource: WALLET_POINT_SOURCE.PURCHASED },
      );

      await recharge.update(
        {
          status: 'PAID',
          razorpayPaymentId: input.razorpayPaymentId,
          creditedLedgerId: ledger.id,
          paidAt: new Date(),
          updatedBy: recharge.userId,
        },
        { transaction },
      );

      return recharge;
    });
  }

  async handlePaymentCaptured(
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ): Promise<boolean> {
    const exists = await WalletRechargeOrder.findOne({ where: { razorpayOrderId } });
    if (!exists) return false;
    await this.creditFromPayment({ razorpayOrderId, razorpayPaymentId });
    return true;
  }

  async handlePaymentFailed(razorpayOrderId: string): Promise<boolean> {
    const recharge = await WalletRechargeOrder.findOne({ where: { razorpayOrderId } });
    if (!recharge || recharge.status !== 'PENDING') return false;
    await recharge.update({ status: 'FAILED', updatedBy: recharge.userId });
    return true;
  }
}

export const walletRechargeService = new WalletRechargeService();
