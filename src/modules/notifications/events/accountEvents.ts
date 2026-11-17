import { randomBytes } from 'crypto';
import { fn, col, where as sqlWhere } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { User } from '@database/models/user.model';
import { logger } from '@core/logger';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '../notifications.service';
import { findSuperAdminUserIds } from '../orderNotifications';
import { inr } from '../templates/blocks';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  const bytes = randomBytes(6);
  return `WELCOME-${Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;
}

/**
 * Issues the one-time welcome coupon for a shopper (once: asking again returns the same one).
 * It is a percentage off the first order, restricted to that shopper, with the amount, cap,
 * minimum and validity coming from Platform Settings. Null when the offer is switched off.
 */
export async function issueWelcomeCoupon(userId: string): Promise<{ code: string; endDate: Date; summary: string } | null> {
  const settings = await settingsService.getPlatformSettings();
  if (!settings.welcomeOfferEnabled) return null;

  const existing = await Coupon.findOne({
    where: sqlWhere(fn('jsonb_extract_path_text', col('config'), 'welcomeForUserId'), userId),
  });
  const percent = Number(settings.welcomeOfferPercent);
  const cap = Number(settings.welcomeOfferMaxDiscount);
  const summarize = (days: number) =>
    `${percent}% off your first order${cap > 0 ? ` (up to ${inr(cap).replace('.00', '')})` : ''} · valid ${days} days`;
  if (existing) return { code: existing.code, endDate: existing.endDate, summary: summarize(settings.welcomeOfferValidDays) };

  const [adminId] = await findSuperAdminUserIds(1);
  const now = new Date();
  const endDate = new Date(now.getTime() + settings.welcomeOfferValidDays * 24 * 60 * 60 * 1000);
  const coupon = await Coupon.create({
    code: randomCode(),
    type: 'PERCENTAGE',
    value: percent,
    maxDiscountCap: cap > 0 ? cap : null,
    minOrderValue: settings.welcomeOfferMinOrder > 0 ? settings.welcomeOfferMinOrder : null,
    minQuantity: null,
    applicableScope: { type: 'all', ids: [] },
    excludedItems: { productIds: [], categoryIds: [] },
    userRestriction: { type: 'specific', value: [userId] },
    config: { welcomeForUserId: userId },
    usageLimitTotal: 1,
    usageLimitPerUser: 1,
    startDate: now,
    endDate,
    stackable: false,
    priority: 0,
    status: 'ACTIVE',
    discountBearer: 'PLATFORM',
    batchId: null,
    vendorId: null,
    createdById: adminId ?? userId,
    updatedBy: null,
    deletedBy: null,
  });
  return { code: coupon.code, endDate, summary: summarize(settings.welcomeOfferValidDays) };
}

/** Welcome email once the address is verified, with the shopper's own first-order code. */
export async function notifyWelcome(userId: string, name?: string | null): Promise<void> {
  try {
    const offer = await issueWelcomeCoupon(userId).catch((error) => {
      logger.warn('Welcome coupon could not be issued', { userId, error: error instanceof Error ? error.message : error });
      return null;
    });
    await notificationsService.sendWelcome(userId, {
      name,
      ...(offer
        ? {
            couponCode: offer.code,
            codeBox: { code: offer.code, caption: offer.summary },
            expiresAt: offer.endDate.toISOString().slice(0, 10),
          }
        : {}),
    });
  } catch (error) {
    logger.warn('Welcome email failed', { userId, error: error instanceof Error ? error.message : error });
  }
}

/** Security notice: the password changed (by the owner or through the reset link). */
export async function notifyPasswordChanged(userId: string, how: 'changed' | 'reset'): Promise<void> {
  await notificationsService
    .enqueue({
      userId,
      type: 'PASSWORD_CHANGED',
      // Each change gets its own email; the timestamp keeps two changes in a day from being treated as one.
      referenceType: 'PasswordChange',
      referenceId: `${userId}-${Date.now()}`,
      templateData: {
        details: [
          { label: 'What happened', value: how === 'reset' ? 'Password reset with an email link' : 'Password changed in your account' },
          { label: 'When', value: new Date().toUTCString() },
        ],
        callout: { tone: 'warning', text: 'If this was not you, reset your password right away — all your devices have been signed out.' },
      },
    })
    .catch((error) => logger.warn('Password changed email failed', { userId, error: error instanceof Error ? error.message : error }));
}

/** An admin blocked or restored the account. */
export async function notifyAccountStatusChange(userId: string, previous: string, next: string, reason?: string | null): Promise<void> {
  const deactivated = next === 'BLOCKED';
  const reactivated = previous === 'BLOCKED' && next === 'ACTIVE';
  if (!deactivated && !reactivated) return;
  await notificationsService
    .enqueue({
      userId,
      type: deactivated ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_REACTIVATED',
      referenceType: 'AccountStatus',
      referenceId: `${userId}-${Date.now()}`,
      templateData: { reasonSuffix: reason ? ` (${reason})` : '', reason: reason ?? '' },
    })
    .catch((error) => logger.warn('Account status email failed', { userId, error: error instanceof Error ? error.message : error }));
}

export async function userDisplayName(userId: string): Promise<string | null> {
  return (await User.findByPk(userId, { attributes: ['name'] }))?.name ?? null;
}
