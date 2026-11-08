import { Op, QueryTypes, literal } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Cart } from '@database/models/cart.model';
import { sequelize } from '@database/models';
import { COUPON_STATUS } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { notificationsService } from '@modules/notifications/notifications.service';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';

const ALERT_COUPON_LIMIT = 200;
const ALERT_CUSTOMER_LIMIT = 500;
const EXPIRING_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;
const NEAR_LIMIT_RATIO = 0.8;

const expiryFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

/** Who answers for a coupon: its vendor's owner, or the admins who manage platform coupons. */
async function couponManagerIds(coupon: Coupon): Promise<string[]> {
  if (coupon.vendorId) {
    const ownerId = await findVendorOwnerUserId(coupon.vendorId);
    return ownerId ? [ownerId] : [];
  }
  const rows = await sequelize.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM users u
     INNER JOIN "RolePermissions" rp ON rp."roleId" = u."roleId"
     INNER JOIN permissions p ON p.id = rp."permissionId"
     WHERE p.key = :permission AND u."deletedAt" IS NULL`,
    { replacements: { permission: PERMISSIONS.COUPON_MANAGE }, type: QueryTypes.SELECT },
  );
  return rows.map((row) => row.id);
}

/**
 * Customers worth telling a coupon is ending: those holding it in a cart (stacked ones too)
 * or who used it before, and who can still use it. Someone at their limit hears nothing.
 */
async function customersWhoCanStillUse(coupon: Coupon): Promise<string[]> {
  const usageRows = await CouponUsage.findAll({
    where: { couponId: coupon.id },
    attributes: ['userId'],
    limit: 2000,
  });
  const usesByCustomer = new Map<string, number>();
  for (const row of usageRows) usesByCustomer.set(row.userId, (usesByCustomer.get(row.userId) ?? 0) + 1);

  const cartHolders = await Cart.findAll({
    where: {
      userId: { [Op.ne]: null },
      [Op.or]: [
        { couponCode: coupon.code },
        literal(`"couponCodes" @> ${sequelize.escape(JSON.stringify([coupon.code]))}::jsonb`),
      ],
    },
    attributes: ['userId'],
    limit: 2000,
  });

  const perUser = coupon.usageLimitPerUser;
  return [
    ...new Set(
      [...usageRows.map((row) => row.userId), ...cartHolders.map((row) => row.userId)].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ]
    .filter((id) => perUser == null || (usesByCustomer.get(id) ?? 0) < perUser)
    .slice(0, ALERT_CUSTOMER_LIMIT);
}

export async function sendCouponAlerts(): Promise<{ notified: number }> {
  const now = new Date();
  const [expiring, nearLimit] = await Promise.all([
    Coupon.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        batchId: null,
        endDate: { [Op.between]: [now, new Date(now.getTime() + EXPIRING_WITHIN_MS)] },
      },
      order: [['endDate', 'ASC']],
      limit: ALERT_COUPON_LIMIT,
    }),
    // Bulk codes are single-use, so "near the limit" would only mean "used".
    Coupon.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        batchId: null,
        usageLimitTotal: { [Op.ne]: null },
        [Op.and]: [literal(`"usedCount" >= CEIL("usageLimitTotal" * ${NEAR_LIMIT_RATIO})`)],
      },
      order: [['usedCount', 'DESC']],
      limit: ALERT_COUPON_LIMIT,
    }),
  ]);

  let notified = 0;
  const count = (log: unknown) => {
    if (log) notified += 1;
  };
  const dataFor = (coupon: Coupon) => ({
    code: coupon.code,
    usedCount: coupon.usedCount ?? 0,
    usageLimit: coupon.usageLimitTotal,
    expiresAt: expiryFormat.format(coupon.endDate),
    actionUrl: `${env.CLIENT_URL}${coupon.vendorId ? '/vendor/dashboard/coupons' : '/admin/coupons'}`,
  });

  for (const coupon of nearLimit) {
    for (const managerId of await couponManagerIds(coupon)) {
      count(await notificationsService.sendCouponUsageLimit(managerId, coupon.id, dataFor(coupon)));
    }
  }
  for (const coupon of expiring) {
    // With the end date, so a coupon given more time and ending again alerts again.
    const reference = `${coupon.id}:${coupon.endDate.toISOString()}`;
    for (const managerId of await couponManagerIds(coupon)) {
      count(await notificationsService.sendCouponExpiring(managerId, reference, dataFor(coupon)));
    }
    for (const customerId of await customersWhoCanStillUse(coupon)) {
      count(
        await notificationsService.sendCouponOfferExpiring(customerId, reference, {
          ...dataFor(coupon),
          actionUrl: `${env.CLIENT_URL}/cart`,
        }),
      );
    }
  }
  return { notified };
}

/** Coupons past their end date read EXPIRED. Redemption checks the dates itself regardless. */
export async function expireCoupons(): Promise<number> {
  const [expired] = await Coupon.update(
    { status: COUPON_STATUS.EXPIRED },
    {
      where: {
        status: { [Op.in]: [COUPON_STATUS.ACTIVE, COUPON_STATUS.PAUSED] },
        endDate: { [Op.lt]: new Date() },
      },
    },
  );
  if (expired > 0) logger.info('Coupons expired', { expired });
  return expired;
}
