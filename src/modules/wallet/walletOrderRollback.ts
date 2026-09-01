import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';

const ROLLBACK_SUFFIX = ' rollback';

export function walletRollbackDescription(): string {
  return `${WALLET_DESCRIPTIONS.CHECKOUT_SPEND}${ROLLBACK_SUFFIX}`;
}

/** True when checkout wallet spend was already credited back for this order. */
export async function hasWalletRollbackCredit(
  orderId: string,
  transaction: Transaction,
): Promise<boolean> {
  const row = await WalletLedger.findOne({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      description: { [Op.like]: `%${ROLLBACK_SUFFIX}` },
    },
    transaction,
  });
  return row != null;
}

async function findCheckoutDebit(
  orderId: string,
  transaction: Transaction,
): Promise<WalletLedger | null> {
  return WalletLedger.findOne({
    where: {
      referenceType: WALLET_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      type: WALLET_LEDGER_TYPE.DEBIT,
    },
    order: [['createdAt', 'DESC']],
    transaction,
  });
}

/**
 * Idempotently restore wallet points debited at checkout for a cancelled order.
 * Restores purchased vs promotional split when the original debit recorded it.
 * Returns true when a new credit was written.
 */
export async function rollbackOrderWalletIfNeeded(
  order: { id: string; walletAmountUsed?: number | null },
  userId: string,
  transaction: Transaction,
): Promise<boolean> {
  const walletUsed = Number(order.walletAmountUsed ?? 0);
  if (walletUsed <= 0) return false;
  if (await hasWalletRollbackCredit(order.id, transaction)) return false;

  const ref = { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id };
  const description = walletRollbackDescription();
  const debit = await findCheckoutDebit(order.id, transaction);
  const breakdown = debit?.pointSourceBreakdown;
  const promoAmount = Number(breakdown?.promotional ?? 0);
  const purchasedAmount = Number(breakdown?.purchased ?? 0);

  if (promoAmount > 0 || purchasedAmount > 0) {
    if (promoAmount > 0) {
      await walletService.credit(
        userId,
        promoAmount,
        ref,
        description,
        transaction,
        { pointSource: WALLET_POINT_SOURCE.PROMOTIONAL },
      );
    }
    if (purchasedAmount > 0) {
      await walletService.credit(
        userId,
        purchasedAmount,
        ref,
        description,
        transaction,
        { pointSource: WALLET_POINT_SOURCE.PURCHASED },
      );
    }
    return true;
  }

  await walletService.credit(
    userId,
    walletUsed,
    ref,
    description,
    transaction,
    { pointSource: WALLET_POINT_SOURCE.PROMOTIONAL },
  );
  return true;
}
