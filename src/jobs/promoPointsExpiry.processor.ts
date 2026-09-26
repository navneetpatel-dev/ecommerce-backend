import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WALLET_LEDGER_TYPE, WALLET_POINT_SOURCE } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';

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
    try {
      const expired = await walletService.expirePromotionalPoints(row.userId, asOf);
      if (expired > 0) expiredUsers += 1;
    } catch (error) {
      logger.warn('Promotional points expiry failed for user', {
        userId: row.userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Promotional points expiry finished', { expiredUsers });
  return { expiredUsers };
}
