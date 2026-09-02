import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { REFUND_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { settingsService } from '@modules/settings/settings.service';
import { paymentsService } from '@modules/payments/payments.service';
import { walletService } from '@modules/wallet/wallet.service';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { walletRechargeService } from '../walletRecharge.service';

const defaultSettings = {
  walletRechargeEnabled: true,
  walletMinRechargeInr: 1,
  walletMaxRechargeInr: 10000,
  walletMaxBalancePoints: 50000,
  walletRechargePresetsInr: [500, 1000],
  pointsPerRupee: 2,
  promotionalPointsTtlDays: 0,
};

function isValidation(err: unknown, message: string): boolean {
  return err instanceof ValidationError && err.message === message;
}

describe('WalletRechargeService.validateRechargeAmount', () => {
  afterEach(() => mock.restoreAll());

  it('rejects disabled recharge', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      ...defaultSettings,
      walletRechargeEnabled: false,
    }));
    mock.method(walletService, 'getBalance', async () => 0);
    await assert.rejects(
      () => walletRechargeService.validateRechargeAmount('user-1', 500),
      (err) => isValidation(err, ERROR_MESSAGES.WALLET_RECHARGE_DISABLED),
    );
  });

  it('rejects amount below minimum', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 0);
    await assert.rejects(
      () => walletRechargeService.validateRechargeAmount('user-1', 0),
      (err) =>
        err instanceof ValidationError && /at least ₹1/.test(err.message),
    );
  });

  it('rejects amount above maximum', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 0);
    await assert.rejects(
      () => walletRechargeService.validateRechargeAmount('user-1', 20000),
      (err) =>
        err instanceof ValidationError &&
        /cannot exceed ₹10,000/.test(err.message),
    );
  });

  it('rejects when bonus points would exceed max balance', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 49900);
    await assert.rejects(
      () => walletRechargeService.validateRechargeAmount('user-1', 100),
      (err) => isValidation(err, ERROR_MESSAGES.WALLET_MAX_BALANCE_EXCEEDED),
    );
  });

  it('returns points using pointsPerRupee', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 0);
    const result = await walletRechargeService.validateRechargeAmount('user-1', 500);
    assert.equal(result.amount, 500);
    assert.equal(result.pointsToCredit, 1000);
  });
});

describe('WalletRechargeService.previewRechargeAmount', () => {
  afterEach(() => mock.restoreAll());

  it('returns preview points and ok validation for valid amount', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 0);
    const preview = await walletRechargeService.previewRechargeAmount('user-1', 500);
    assert.equal(preview.validationCode, 'ok');
    assert.equal(preview.pointsToCredit, 1000);
  });

  it('returns max-balance without throwing', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 49900);
    const preview = await walletRechargeService.previewRechargeAmount('user-1', 100);
    assert.equal(preview.validationCode, 'max-balance');
  });
});

describe('WalletRechargeService.handlePaymentFailed', () => {
  afterEach(() => mock.restoreAll());

  it('marks pending recharge as FAILED', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const recharge = {
      id: 'recharge-1',
      userId: 'user-1',
      status: 'PENDING',
      amountInr: 500,
      update: async (values: Record<string, unknown>) => {
        updates.push(values);
      },
    };
    mock.method(WalletRechargeOrder, 'findOne', async () => recharge);
    mock.method(notificationsService, 'sendWalletRechargeFailed', async () => undefined);

    const handled = await walletRechargeService.handlePaymentFailed('order_rzp_1');
    assert.equal(handled, true);
    assert.equal(updates[0]?.status, 'FAILED');
  });

  it('returns false when no pending recharge exists', async () => {
    mock.method(WalletRechargeOrder, 'findOne', async () => null);
    const handled = await walletRechargeService.handlePaymentFailed('order_missing');
    assert.equal(handled, false);
  });
});

describe('WalletRechargeService.handlePaymentCaptured max balance', () => {
  afterEach(() => mock.restoreAll());

  it('initiates refund when credit would exceed max balance', async () => {
    const rechargeRow = {
      id: 'recharge-cap',
      userId: 'user-cap',
      status: 'PENDING',
      pointsCredited: 1000,
      amountInr: 500,
      creditedLedgerId: null,
      razorpayRefundId: null,
      refundStatus: REFUND_STATUS.NONE,
      update: async function (this: Record<string, unknown>, values: Record<string, unknown>) {
        Object.assign(this, values);
        return this;
      },
    };

    mock.method(sequelize, 'transaction', async (callback: (t: { LOCK: { UPDATE: string } }) => unknown) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    mock.method(WalletRechargeOrder, 'findOne', async () => rechargeRow);
    mock.method(settingsService, 'getPlatformSettings', async () => defaultSettings);
    mock.method(walletService, 'getBalance', async () => 49500);
    mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_cap_1');
    mock.method(notificationsService, 'sendWalletRechargeFailed', async () => undefined);

    const handled = await walletRechargeService.handlePaymentCaptured('order_cap', 'pay_cap');
    assert.equal(handled, true);
    assert.equal(rechargeRow.status, 'FAILED');
    assert.equal(rechargeRow.refundStatus, REFUND_STATUS.INITIATED);
  });
});
