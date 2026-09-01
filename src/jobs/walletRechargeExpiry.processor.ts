import { Op } from 'sequelize';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';

export const WALLET_RECHARGE_EXPIRY_JOB = 'wallet-recharge-expiry';

export function walletRechargePendingTtlHours(): number {
  return env.WALLET_RECHARGE_PENDING_TTL_HOURS;
}

export async function runWalletRechargeExpiry(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - walletRechargePendingTtlHours() * 60 * 60 * 1000);
  let expired = 0;

  while (true) {
    const batch = await WalletRechargeOrder.findAll({
      where: {
        status: 'PENDING',
        createdAt: { [Op.lt]: cutoff },
      },
      limit: 500,
      attributes: ['id'],
    });
    if (batch.length === 0) break;

    const ids = batch.map((r) => r.id);
    const [count] = await WalletRechargeOrder.update(
      { status: 'EXPIRED' },
      { where: { id: { [Op.in]: ids }, status: 'PENDING' } },
    );
    expired += count;
    if (batch.length < 500) break;
  }

  logger.info('Wallet recharge expiry finished', { expired, cutoff: cutoff.toISOString() });
  return { expired };
}
