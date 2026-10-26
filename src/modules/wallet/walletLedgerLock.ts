import type { Transaction } from 'sequelize';
import { User } from '@database/models/user.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { roundMoney } from '@modules/pricing/money';

/**
 * Serialize all wallet mutations per user — including when the ledger is empty
 * (FOR UPDATE on WalletLedger alone cannot lock a missing row).
 */
export async function acquireUserWalletLock(userId: string, transaction: Transaction): Promise<void> {
  const user = await User.findByPk(userId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!user) {
    throw new ValidationError(ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED);
  }
}

export async function lockedBalance(userId: string, transaction: Transaction): Promise<number> {
  await acquireUserWalletLock(userId, transaction);
  const last = await WalletLedger.findOne({
    where: { userId },
    order: [['createdAt', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  // The balance is the latest row's `balanceAfter`, latest by `createdAt`: two rows in
  // the same millisecond (a rollback writes two credits back to back) tie, and either
  // could be read as the last. Writes run one at a time under the lock above, so wait
  // until the clock is past the last row: the row about to be written sorts after it.
  const lastAt = last?.createdAt ? new Date(last.createdAt).getTime() : 0;
  while (Date.now() <= lastAt) await new Promise((resolve) => setTimeout(resolve, 1));
  return roundMoney(Number(last?.balanceAfter ?? 0));
}
