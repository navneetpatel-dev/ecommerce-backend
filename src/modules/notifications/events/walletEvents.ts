import { Op } from 'sequelize';
import { logger } from '@core/logger';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { WALLET_LEDGER_TYPE, WALLET_POINT_SOURCE } from '@core/constants/statuses';
import { walletService } from '@modules/wallet/wallet.service';
import { getPointSourceBalances, sumExpiredPromotionalCredits, sumPromotionalCredits } from '@modules/wallet/walletBalances';
import { promotionalExpiryDebitAmount } from '@modules/wallet/walletExpiry';
import { orderReference } from '@modules/orders/orderReference';
import { notificationsService } from '../notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const points = (value: number) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** A top-up cleared and the points are in the wallet. */
export async function notifyWalletRecharged(rechargeId: string): Promise<void> {
  try {
    const recharge = await WalletRechargeOrder.findByPk(rechargeId);
    if (!recharge) return;
    const balance = await walletService.getBalance(recharge.userId);
    await notificationsService.enqueue({
      userId: recharge.userId,
      type: 'WALLET_RECHARGE_SUCCESS',
      referenceType: 'WalletRecharge',
      referenceId: recharge.id,
      templateData: {
        amount: Number(recharge.amountInr),
        details: [
          { label: 'Amount paid', value: `₹${points(Number(recharge.amountInr))}` },
          { label: 'Points added', value: points(Number(recharge.pointsCredited)) },
          { label: 'Wallet balance', value: `${points(balance)} points` },
        ],
      },
    });
  } catch (error) {
    logger.warn('Wallet recharge email failed', { rechargeId, error: error instanceof Error ? error.message : error });
  }
}

/** Order cashback landed in the wallet. */
export async function notifyCashbackCredited(userId: string, orderId: string, amount: number): Promise<void> {
  try {
    const balance = await walletService.getBalance(userId);
    await notificationsService.enqueue({
      userId,
      type: 'CASHBACK_CREDITED',
      referenceType: 'Cashback',
      referenceId: orderId,
      templateData: {
        amount,
        orderNumber: orderReference(orderId),
        orderId,
        details: [{ label: 'Wallet balance', value: `${points(balance)} points` }],
      },
    });
  } catch (error) {
    logger.warn('Cashback email failed', { orderId, error: error instanceof Error ? error.message : error });
  }
}

/**
 * Shoppers whose promotional points expire within a week and are still unspent get one
 * reminder per expiry date. Returns how many were queued.
 */
export async function processExpiringPointsReminders(now: Date = new Date(), windowDays = 7): Promise<number> {
  const horizon = new Date(now.getTime() + windowDays * DAY_MS);
  const lots = await WalletLedger.findAll({
    where: {
      type: WALLET_LEDGER_TYPE.CREDIT,
      pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      expiresAt: { [Op.gt]: now, [Op.lte]: horizon },
    },
    attributes: ['userId', 'expiresAt'],
    order: [['expiresAt', 'ASC']],
  });
  const firstExpiry = new Map<string, Date>();
  for (const lot of lots) if (lot.expiresAt && !firstExpiry.has(lot.userId)) firstExpiry.set(lot.userId, lot.expiresAt);

  let queued = 0;
  for (const [userId, expiresAt] of firstExpiry) {
    try {
      const [expiredNow, expiredByHorizon, credits, balances] = await Promise.all([
        sumExpiredPromotionalCredits(userId, now),
        sumExpiredPromotionalCredits(userId, horizon),
        sumPromotionalCredits(userId),
        getPointSourceBalances(userId),
      ]);
      const debitAt = (expiredLots: number) =>
        promotionalExpiryDebitAmount({ expiredLots, promotionalCredits: credits, netPromotional: balances.promotional });
      const expiring = debitAt(expiredByHorizon) - debitAt(expiredNow);
      if (expiring <= 0) continue;
      const day = expiresAt.toISOString().slice(0, 10);
      const log = await notificationsService.enqueue({
        userId,
        type: 'POINTS_EXPIRING',
        referenceType: 'PointsExpiry',
        referenceId: `${userId}-${day}`,
        templateData: { points: points(expiring), expiresAt: day },
      });
      if (log) queued += 1;
    } catch (error) {
      logger.warn('Points expiry reminder failed', { userId, error: error instanceof Error ? error.message : error });
    }
  }
  return queued;
}
