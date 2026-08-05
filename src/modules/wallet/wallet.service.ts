import { ValidationError } from '@core/errors/ValidationError';
import { walletRepository } from './wallet.repository';
import { WalletLedger } from '@database/models/walletLedger.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';

export class WalletService {
  async getBalance(userId: string): Promise<number> {
    const latest = await walletRepository.getLatestEntry(userId);
    return latest ? Number(latest.balanceAfter) : 0;
  }

  async getTransactions(userId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;
    const { rows, count } = await walletRepository.getUserTransactions(userId, limit, offset);
    
    return {
      transactions: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  async credit(
    userId: string,
    amount: number,
    reference: { type: string; id: string },
    description: string,
    expiresAt?: Date,
    transaction?: Transaction
  ) {
    const executeCredit = async (t: Transaction) => {
      // Lock the latest entry to prevent concurrent balance issues
      const latest = await WalletLedger.findOne({
        where: { userId },
        order: [['createdAt', 'DESC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const currentBalance = latest ? Number(latest.balanceAfter) : 0;
      const newBalance = currentBalance + amount;

      return WalletLedger.create({
        userId,
        type: 'CREDIT',
        amount,
        balanceAfter: newBalance,
        referenceType: reference.type,
        referenceId: reference.id,
        description,
        expiresAt: expiresAt ?? null,
      }, { transaction: t });
    };

    if (transaction) {
      return executeCredit(transaction);
    }

    return sequelize.transaction(executeCredit);
  }

  async debit(
    userId: string,
    amount: number,
    reference: { type: string; id: string },
    description: string,
    transaction?: Transaction
  ) {
    const executeDebit = async (t: Transaction) => {
      // Lock the latest entry to prevent concurrent balance issues
      const latest = await WalletLedger.findOne({
        where: { userId },
        order: [['createdAt', 'DESC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const currentBalance = latest ? Number(latest.balanceAfter) : 0;

      if (currentBalance < amount) {
        throw new ValidationError('Insufficient wallet balance');
      }

      const newBalance = currentBalance - amount;

      return WalletLedger.create({
        userId,
        type: 'DEBIT',
        amount,
        balanceAfter: newBalance,
        referenceType: reference.type,
        referenceId: reference.id,
        description,
        expiresAt: null,
      }, { transaction: t });
    };

    if (transaction) {
      return executeDebit(transaction);
    }

    return sequelize.transaction(executeDebit);
  }
}

export const walletService = new WalletService();
