import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WALLET_REFERENCE_TYPE } from '@core/constants/statuses';
import { fromPaise, toPaise } from '@modules/pricing/money';

/**
 * Cashback taken back from the wallet for each of these returns (rupees), in one query.
 * The wallet entry points at the return, so the return card can say why the wallet rose
 * by less than the refund.
 */
export async function cashbackClawbacksFor(returnIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (returnIds.length === 0) return out;
  const rows = await WalletLedger.findAll({
    where: { referenceType: WALLET_REFERENCE_TYPE.CLAWBACK, referenceId: { [Op.in]: returnIds } },
    attributes: ['referenceId', 'amount'],
  });
  for (const row of rows) {
    const id = String(row.referenceId);
    out.set(id, fromPaise((toPaise(out.get(id) ?? 0)) + toPaise(Math.abs(Number(row.amount)))));
  }
  return out;
}
