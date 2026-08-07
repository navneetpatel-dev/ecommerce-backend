import type { Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import {
  DISCOUNT_BEARER,
  WALLET_LEDGER_TYPE,
  type DiscountBearer,
} from '@core/constants/statuses';
import { fromPaise, toPaise } from '@modules/pricing/money';

export type WalletRef = { type: string; id: string };

function roundRupees(n: number): number {
  return fromPaise(toPaise(n));
}

async function lockedBalance(userId: string, transaction: Transaction): Promise<number> {
  const last = await WalletLedger.findOne({
    where: { userId },
    order: [['createdAt', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  return roundRupees(Number(last?.balanceAfter ?? 0));
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
    return roundRupees(Number(last?.balanceAfter ?? 0));
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

  async credit(
    userId: string,
    amount: number,
    ref: WalletRef,
    description: string,
    outerTransaction?: Transaction,
  ): Promise<WalletLedger> {
    const value = roundRupees(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      const balanceAfter = roundRupees(balance + value);
      return WalletLedger.create(
        {
          userId,
          type: WALLET_LEDGER_TYPE.CREDIT,
          amount: value,
          balanceAfter,
          referenceType: ref.type,
          referenceId: ref.id,
          description,
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
    const value = roundRupees(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      if (value > balance) {
        throw new ValidationError(ERROR_MESSAGES.WALLET_INSUFFICIENT_BALANCE);
      }
      const balanceAfter = roundRupees(balance - value);
      return WalletLedger.create(
        {
          userId,
          type: WALLET_LEDGER_TYPE.DEBIT,
          amount: value,
          balanceAfter,
          referenceType: ref.type,
          referenceId: ref.id,
          description,
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
    const value = roundRupees(amount);
    if (value <= 0) {
      throw new ValidationError(ERROR_MESSAGES.WALLET_INVALID_AMOUNT);
    }

    const run = async (transaction: Transaction) => {
      const balance = await lockedBalance(userId, transaction);
      const recoveredAmount = roundRupees(Math.min(balance, value));
      const writtenOffAmount = roundRupees(value - recoveredAmount);

      let ledger: WalletLedger | null = null;
      if (recoveredAmount > 0) {
        const balanceAfter = roundRupees(balance - recoveredAmount);
        ledger = await WalletLedger.create(
          {
            userId,
            type: WALLET_LEDGER_TYPE.DEBIT,
            amount: recoveredAmount,
            balanceAfter,
            referenceType: ref.type,
            referenceId: ref.id,
            description,
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
