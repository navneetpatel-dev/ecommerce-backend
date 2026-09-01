import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import {
  getPointSourceBalances,
  sumExpiredPromotionalCredits,
} from '@modules/wallet/walletBalances';
import { promotionalExpiryDebitAmount } from '@modules/wallet/walletExpiry';

export const PROMO_POINTS_EXPIRY_JOB = 'promo-points-expiry';

export async function runPromoPointsExpiry(): Promise<{ expiredUsers: number }> {
  const settings = await settingsService.getPlatformSettings();
  const ttlDays = Number(settings.promotionalPointsTtlDays ?? 0);
  if (ttlDays <= 0) return { expiredUsers: 0 };

  const asOf = new Date();
  const expiredCredits = await WalletLedger.findAll({
    where: {
      type: WALLET_LEDGER_TYPE.CREDIT,
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      expiresAt: { [Op.lte]: asOf },
    },
    attributes: ['userId'],
    group: ['userId'],
  });

  let expiredUsers = 0;
  for (const row of expiredCredits) {
    const [expiredLots, balances] = await Promise.all([
      sumExpiredPromotionalCredits(row.userId, asOf),
      getPointSourceBalances(row.userId),
    ]);
    const promoToExpire = promotionalExpiryDebitAmount(expiredLots, balances.promotional);
    if (promoToExpire <= 0) continue;
    try {
      await walletService.debit(
        row.userId,
        promoToExpire,
        { type: WALLET_REFERENCE_TYPE.EXPIRY, id: row.userId },
        WALLET_DESCRIPTIONS.PROMO_EXPIRY,
      );
      expiredUsers += 1;
    } catch {
      /* insufficient — partial expiry already consumed elsewhere */
    }
  }

  logger.info('Promotional points expiry finished', { expiredUsers });
  return { expiredUsers };
}
