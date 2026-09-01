import type { Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { User } from '@database/models/user.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import {
  DISCOUNT_BEARER,
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
  type DiscountBearer,
} from '@core/constants/statuses';
import { fromPaise, toPaise, roundMoney } from '@modules/pricing/money';
import {
  allocateDebitFromBalances,
  getPointSourceBalances,
  type PointSourceBalances,
} from './walletBalances';
import { promotionalCreditExpiryDate } from './walletExpiry';

export type WalletRef = { type: string; id: string };

export type WalletCreditOptions = {
  pointSource?: 'PURCHASED' | 'PROMOTIONAL' | null;
  expiresAt?: Date | null;
};

export type WalletTransactionView = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  rechargeId: string | null;
  description: string | null;
  pointSource: string | null;
  createdAt: Date;
};

function serializeWalletLedger(row: WalletLedger): WalletTransactionView {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balanceAfter),
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    rechargeId: row.referenceType === WALLET_REFERENCE_TYPE.TOPUP ? row.referenceId : null,
    description: row.description,
    pointSource: row.pointSource,
    createdAt: row.createdAt,
  };
}

/**
 * Serialize all wallet mutations per user — including when the ledger is empty
 * (FOR UPDATE on WalletLedger alone cannot lock a missing row).
 */
async function acquireUserWalletLock(userId: string, transaction: Transaction): Promise<void> {
  const user = await User.findByPk(userId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!user) {
    throw new ValidationError(ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED);
  }
}

async function lockedBalance(userId: string, transaction: Transaction): Promise<number> {
  await acquireUserWalletLock(userId, transaction);
  const last = await WalletLedger.findOne({
    where: { userId },
    order: [['createdAt', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  return roundMoney(Number(last?.balanceAfter ?? 0));
}

/**
 * Single gate for all WalletLedger writes.
 * Nothing else in the codebase should create wallet rows directly.
 */
export class WalletService {
  async getBalance(userId: string, transaction?: Transaction): Promise<number> {
    const last = await WalletLedger.findOne({
      where: { userId },
      order: [['createdAt', 'DESC']],
      transaction,
    });
    return roundMoney(Number(last?.balanceAfter ?? 0));
  }

  async getPointSourceBalances(
    userId: string,
    transaction?: Transaction,
  ): Promise<PointSourceBalances> {
    return getPointSourceBalances(userId, transaction);
  }

  async listTransactions(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<WalletLedger[]> {
    return WalletLedger.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    });
  }

  async listTransactionsView(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<WalletTransactionView[]> {
    const rows = await this.listTransactions(userId, opts);
    return rows.map(serializeWalletLedger);
  }

  async credit(
    userId: string,
    amount: number,
    ref: WalletRef,
    description: string,
    outerTransaction?: Transaction,
    options?: WalletCreditOptions,
  ): Promise<WalletLedger> {
    const value = roundMoney(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      const balanceAfter = roundMoney(balance + value);
      const pointSource = options?.pointSource ?? null;
      const expiresAt =
        options && Object.prototype.hasOwnProperty.call(options, 'expiresAt')
          ? (options.expiresAt ?? null)
          : pointSource === WALLET_POINT_SOURCE.PROMOTIONAL
            ? await promotionalCreditExpiryDate()
            : null;
      return WalletLedger.create(
        {
          userId,
          type: WALLET_LEDGER_TYPE.CREDIT,
          amount: value,
          balanceAfter,
          referenceType: ref.type,
          referenceId: ref.id,
          description,
          pointSource,
          expiresAt,
          pointSourceBreakdown: null,
          createdBy: userId,
          updatedBy: userId,
          deletedBy: null,
        },
        { transaction },
      );
    };

    if (outerTransaction) return run(outerTransaction);
    return sequelize.transaction(run);
  }

  async debit(
    userId: string,
    amount: number,
    ref: WalletRef,
    description: string,
    outerTransaction?: Transaction,
  ): Promise<WalletLedger> {
    const value = roundMoney(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      if (value > balance) {
        throw new ValidationError(ERROR_MESSAGES.WALLET_INSUFFICIENT_BALANCE);
      }
      const sourceBalances = await getPointSourceBalances(userId, transaction);
      const breakdown = allocateDebitFromBalances(value, sourceBalances);
      const balanceAfter = roundMoney(balance - value);
      return WalletLedger.create(
        {
          userId,
          type: WALLET_LEDGER_TYPE.DEBIT,
          amount: value,
          balanceAfter,
          referenceType: ref.type,
          referenceId: ref.id,
          description,
          pointSource: null,
          expiresAt: null,
          pointSourceBreakdown: breakdown,
          createdBy: userId,
          updatedBy: userId,
          deletedBy: null,
        },
        { transaction },
      );
    };

    if (outerTransaction) return run(outerTransaction);
    return sequelize.transaction(run);
  }

  /**
   * Recover up to available balance; never go negative.
   * Writes WalletWriteOff for any unrecovered shortfall.
   */
  async clawback(
    userId: string,
    amount: number,
    ref: WalletRef,
    description: string,
    bornBy: DiscountBearer = DISCOUNT_BEARER.PLATFORM,
    outerTransaction?: Transaction,
  ): Promise<{ recoveredAmount: number; writtenOffAmount: number; ledger: WalletLedger | null }> {
    const value = roundMoney(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      const recoveredAmount = roundMoney(Math.min(balance, value));
      const writtenOffAmount = roundMoney(value - recoveredAmount);

      let ledger: WalletLedger | null = null;
      if (recoveredAmount > 0) {
        const sourceBalances = await getPointSourceBalances(userId, transaction);
        const breakdown = allocateDebitFromBalances(recoveredAmount, sourceBalances);
        const balanceAfter = roundMoney(balance - recoveredAmount);
        ledger = await WalletLedger.create(
          {
            userId,
            type: WALLET_LEDGER_TYPE.DEBIT,
            amount: recoveredAmount,
            balanceAfter,
            referenceType: ref.type,
            referenceId: ref.id,
            description,
            pointSource: null,
            expiresAt: null,
            pointSourceBreakdown: breakdown,
            createdBy: userId,
            updatedBy: userId,
            deletedBy: null,
          },
          { transaction },
        );
      }

      if (writtenOffAmount > 0) {
        await WalletWriteOff.create(
          {
            userId,
            originalClawbackAmount: value,
            recoveredAmount,
            writtenOffAmount,
            referenceType: ref.type,
            referenceId: ref.id,
            bornBy,
            createdBy: userId,
            updatedBy: userId,
            deletedBy: null,
          },
          { transaction },
        );
      }

      return { recoveredAmount, writtenOffAmount, ledger };
    };

    if (outerTransaction) return run(outerTransaction);
    return sequelize.transaction(run);
  }
}

export const walletService = new WalletService();
