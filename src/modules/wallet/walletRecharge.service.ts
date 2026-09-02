import { env } from '@config/env';
import { razorpay, razorpayConfigured } from '@config/razorpay';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import {
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
  REFUND_STATUS,
} from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { settingsService } from '@modules/settings/settings.service';
import { roundMoney } from '@modules/pricing/money';
import { paymentsService } from '@modules/payments/payments.service';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';
import { ensureWalletRechargeInvoice } from './walletRechargeInvoice.service';
import {
  checkWalletRechargeAmountRange,
  walletRechargeAmountRangeMessage,
} from './walletRechargeAmount.validation';

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

  async getBalanceView(userId: string) {
    const [balance, limits, subBalances] = await Promise.all([
      walletService.getBalance(userId),
      this.getRechargeLimits(),
      walletService.getPointSourceBalances(userId),
    ]);
    return {
      balance,
      points: balance,
      unit: 'POINT' as const,
      redemptionRate: 1,
      purchasedBalance: subBalances.purchased,
      promotionalBalance: subBalances.promotional,
      rechargeEnabled: limits.rechargeEnabled,
      limits: {
        minInr: limits.minInr,
        maxInr: limits.maxInr,
        maxBalance: limits.maxBalance,
        presetsInr: limits.presetsInr,
        pointsPerRupee: limits.pointsPerRupee,
      },
    };
  }

  async downloadInvoicePdf(userId: string, rechargeId: string) {
    const { getWalletRechargeInvoicePdf } = await import('./walletRechargeInvoice.service');
    return getWalletRechargeInvoicePdf(userId, rechargeId);
  }

  async validateRechargeAmount(userId: string, amountInr: number) {
    const settings = await settingsService.getPlatformSettings();
    if (!settings.walletRechargeEnabled) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_DISABLED);
    }
    const amount = roundMoney(amountInr);
    const rangeError = checkWalletRechargeAmountRange(amount, {
      minInr: settings.walletMinRechargeInr,
      maxInr: settings.walletMaxRechargeInr,
    });
    if (rangeError === 'below-min') {
      throw new ValidationError(
        walletRechargeAmountRangeMessage('below-min', {
          minInr: settings.walletMinRechargeInr,
          maxInr: settings.walletMaxRechargeInr,
        }),
      );
    }
    if (rangeError === 'above-max') {
      throw new ValidationError(
        walletRechargeAmountRangeMessage('above-max', {
          minInr: settings.walletMinRechargeInr,
          maxInr: settings.walletMaxRechargeInr,
        }),
      );
    }
    const pointsToCredit = roundMoney(amount * settings.pointsPerRupee);
    const balance = await walletService.getBalance(userId);
    if (balance + pointsToCredit > settings.walletMaxBalancePoints) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED);
    }
    return { amount, pointsToCredit, settings };
  }

  async previewRechargeAmount(userId: string, amountInr: number) {
    const settings = await settingsService.getPlatformSettings();
    if (!settings.walletRechargeEnabled) {
      return {
        amountInr: 0,
        pointsToCredit: 0,
        validationCode: 'disabled' as const,
      };
    }

    const amount = roundMoney(amountInr);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        amountInr: amount,
        pointsToCredit: 0,
        validationCode: 'below-min' as const,
      };
    }

    const rangeError = checkWalletRechargeAmountRange(amount, {
      minInr: settings.walletMinRechargeInr,
      maxInr: settings.walletMaxRechargeInr,
    });
    if (rangeError === 'below-min' || rangeError === 'above-max') {
      return {
        amountInr: amount,
        pointsToCredit: 0,
        validationCode: rangeError,
      };
    }

    const pointsToCredit = roundMoney(amount * settings.pointsPerRupee);
    const balance = await walletService.getBalance(userId);
    if (balance + pointsToCredit > settings.walletMaxBalancePoints) {
      return {
        amountInr: amount,
        pointsToCredit,
        validationCode: 'max-balance' as const,
      };
    }

    return {
      amountInr: amount,
      pointsToCredit,
      validationCode: 'ok' as const,
    };
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

    const { amount, pointsToCredit, settings } = await this.validateRechargeAmount(userId, amountInr);

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
      if (
        existing &&
        existing.status === 'PENDING' &&
        !existing.razorpayOrderId
      ) {
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
          amountInr: amount,
          pointsCredited: pointsToCredit,
          pointsPerRupee: (await settingsService.getPlatformSettings()).pointsPerRupee,
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
      throw new ValidationError(ERROR_MESSAGES.WALLET_RECHARGE_RAZORPAY_MIN);
    }

    const recharge = await WalletRechargeOrder.create({
      userId,
      amountInr: amount,
      pointsCredited: pointsToCredit,
      pointsPerRupee: settings.pointsPerRupee,
      status: 'PENDING',
      refundStatus: 'NONE',
      idempotencyKey: idempotencyKey ?? null,
      createdBy: userId,
      updatedBy: userId,
      deletedBy: null,
    });

    try {
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
    } catch (err) {
      await recharge.update({ status: 'FAILED', updatedBy: userId });
      throw err;
    }
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
    let maxBalanceRecharge: WalletRechargeOrder | null = null;
    let maxBalancePaymentId: string | null = null;

    const recharge = await sequelize.transaction(async (transaction) => {
      const row = await WalletRechargeOrder.findOne({
        where: { razorpayOrderId: input.razorpayOrderId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!row) {
        throw new NotFoundError('WalletRechargeOrder');
      }
      if (input.expectedUserId && row.userId !== input.expectedUserId) {
        throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (input.expectedRechargeId && row.id !== input.expectedRechargeId) {
        throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
      }
      if (row.status === 'PAID' && row.creditedLedgerId) {
        return row;
      }

      const settings = await settingsService.getPlatformSettings();
      const balance = await walletService.getBalance(row.userId, transaction);
      const points = Number(row.pointsCredited);
      if (balance + points > settings.walletMaxBalancePoints) {
        await row.update(
          {
            status: 'FAILED',
            razorpayPaymentId: input.razorpayPaymentId,
            refundStatus: REFUND_STATUS.PENDING,
            updatedBy: row.userId,
          },
          { transaction },
        );
        maxBalanceRecharge = row;
        maxBalancePaymentId = input.razorpayPaymentId;
        return row;
      }

      const ledger = await walletService.credit(
        row.userId,
        points,
        { type: WALLET_REFERENCE_TYPE.TOPUP, id: row.id },
        WALLET_DESCRIPTIONS.TOPUP_CREDIT,
        transaction,
        { pointSource: WALLET_POINT_SOURCE.PURCHASED },
      );

      await row.update(
        {
          status: 'PAID',
          razorpayPaymentId: input.razorpayPaymentId,
          creditedLedgerId: ledger.id,
          paidAt: new Date(),
          updatedBy: row.userId,
        },
        { transaction },
      );

      return row;
    });

    if (recharge.status === 'PAID') {
      await ensureWalletRechargeInvoice(recharge.id).catch(() => undefined);
    }

    if (maxBalanceRecharge && maxBalancePaymentId) {
      await this.initiateMaxBalanceRefund(maxBalanceRecharge, maxBalancePaymentId);
      throw new ValidationError(ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED);
    }

    if (recharge.status === 'FAILED' && recharge.refundStatus === REFUND_STATUS.PENDING) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED);
    }

    return recharge;
  }

  private async initiateMaxBalanceRefund(
    recharge: WalletRechargeOrder,
    razorpayPaymentId: string,
  ): Promise<void> {
    const amountPaise = Math.round(Number(recharge.amountInr) * 100);
    try {
      const refundId = await paymentsService.createRazorpayRefund(razorpayPaymentId, amountPaise, {
        rechargeId: recharge.id,
        reason: 'MAX_BALANCE_EXCEEDED',
      });
      await recharge.update({
        refundStatus: REFUND_STATUS.INITIATED,
        razorpayRefundId: refundId,
        updatedBy: recharge.userId,
      });
      const { notificationsService } = await import('@modules/notifications/notifications.service');
      void notificationsService.sendWalletRechargeFailed(recharge.userId, recharge.id, {
        rechargeId: recharge.id,
        amountInr: Number(recharge.amountInr),
        reason: 'max_balance_refund_initiated',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refund initiation failed';
      await recharge.update({
        refundStatus: REFUND_STATUS.FAILED,
        refundFailureReason: message.slice(0, 255),
        updatedBy: recharge.userId,
      });
    }
  }

  async markRazorpayRefundProcessed(input: {
    razorpayRefundId: string;
    rechargeId: string;
  }): Promise<void> {
    const recharge = await WalletRechargeOrder.findByPk(input.rechargeId);
    if (!recharge) return;
    await recharge.update({
      refundStatus: REFUND_STATUS.COMPLETED,
      razorpayRefundId: input.razorpayRefundId,
      updatedBy: recharge.userId,
    });
    const { notificationsService } = await import('@modules/notifications/notifications.service');
    void notificationsService.sendWalletRechargeFailed(recharge.userId, recharge.id, {
      rechargeId: recharge.id,
      amountInr: Number(recharge.amountInr),
      reason: 'max_balance_refunded',
    });
  }

  async handlePaymentCaptured(
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ): Promise<boolean> {
    const exists = await WalletRechargeOrder.findOne({ where: { razorpayOrderId } });
    if (!exists) return false;
    try {
      await this.creditFromPayment({ razorpayOrderId, razorpayPaymentId });
    } catch (err) {
      if (
        err instanceof ValidationError &&
        err.message === ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED
      ) {
        return true;
      }
      throw err;
    }
    return true;
  }

  async handlePaymentFailed(razorpayOrderId: string): Promise<boolean> {
    const recharge = await WalletRechargeOrder.findOne({ where: { razorpayOrderId } });
    if (!recharge || recharge.status !== 'PENDING') return false;
    await recharge.update({ status: 'FAILED', updatedBy: recharge.userId });
    const { notificationsService } = await import('@modules/notifications/notifications.service');
    void notificationsService.sendWalletRechargeFailed(recharge.userId, recharge.id, {
      rechargeId: recharge.id,
      amountInr: Number(recharge.amountInr),
      reason: 'payment_failed',
    });
    return true;
  }
}

export const walletRechargeService = new WalletRechargeService();
