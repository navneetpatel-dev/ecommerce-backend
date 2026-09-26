import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
} from '@core/constants/statuses';
import { roundMoney, sumRupees } from '@modules/pricing/money';

export type PointSourceBalances = {
  purchased: number;
  promotional: number;
  total: number;
};

/** Net purchased vs promotional balances from ledger history (FIFO policy on debit). */
export async function getPointSourceBalances(
  userId: string,
  transaction?: Transaction,
): Promise<PointSourceBalances> {
  const rows = await WalletLedger.findAll({
    where: { userId },
    order: [['createdAt', 'ASC']],
    transaction,
  });

  let purchased = 0;
  let promotional = 0;

  for (const row of rows) {
    const amount = roundMoney(Number(row.amount));
    if (row.type === WALLET_LEDGER_TYPE.CREDIT) {
      if (row.pointSource === WALLET_POINT_SOURCE.PURCHASED) {
        purchased = roundMoney(purchased + amount);
      } else {
        promotional = roundMoney(promotional + amount);
      }
      continue;
    }

    const breakdown = row.pointSourceBreakdown as
      | { promotional?: number; purchased?: number }
      | null
      | undefined;
    if (breakdown) {
      promotional = roundMoney(promotional - Number(breakdown.promotional ?? 0));
      purchased = roundMoney(purchased - Number(breakdown.purchased ?? 0));
    } else {
      const fromPromo = roundMoney(Math.min(promotional, amount));
      promotional = roundMoney(promotional - fromPromo);
      purchased = roundMoney(purchased - roundMoney(amount - fromPromo));
    }
  }

  purchased = roundMoney(Math.max(0, purchased));
  promotional = roundMoney(Math.max(0, promotional));
  return { purchased, promotional, total: roundMoney(purchased + promotional) };
}

export function allocateDebitFromBalances(
  amount: number,
  balances: PointSourceBalances,
): { promotional: number; purchased: number } {
  const value = roundMoney(amount);
  const fromPromotional = roundMoney(Math.min(balances.promotional, value));
  const fromPurchased = roundMoney(value - fromPromotional);
  return { promotional: fromPromotional, purchased: fromPurchased };
}

export async function sumExpiredPromotionalCredits(
  userId: string,
  asOf: Date,
  transaction?: Transaction,
): Promise<number> {
  const rows = await WalletLedger.findAll({
    where: {
      userId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      expiresAt: { [Op.lte]: asOf },
    },
    transaction,
  });
  return sumRupees(rows.map((row) => row.amount));
}

/** Every promotional credit the user ever received (credits not marked purchased). */
export async function sumPromotionalCredits(
  userId: string,
  transaction?: Transaction,
): Promise<number> {
  const rows = await WalletLedger.findAll({
    where: {
      userId,
      type: WALLET_LEDGER_TYPE.CREDIT,
      [Op.or]: [
        { pointSource: { [Op.ne]: WALLET_POINT_SOURCE.PURCHASED } },
        { pointSource: null },
      ],
    },
    attributes: ['amount'],
    transaction,
  });
  return sumRupees(rows.map((row) => row.amount));
}
