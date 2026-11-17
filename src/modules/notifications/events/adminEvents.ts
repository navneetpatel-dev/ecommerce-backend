import { logger } from '@core/logger';
import { User } from '@database/models/user.model';
import { notificationsService } from '../notifications.service';
import { findSuperAdminUserIds } from '../orderNotifications';

/** Settings an admin should hear about when someone else changes them. */
const WATCHED: Record<string, string> = {
  maintenanceEnabled: 'Maintenance mode',
  maintenanceMessage: 'Maintenance message',
  payoutCycle: 'Payout cycle',
  defaultCommissionRate: 'Default commission rate',
  tcsRatePercent: 'TCS rate',
  tdsRatePercent: 'TDS rate',
  commissionGstRatePercent: 'Commission GST rate',
  platformGstin: 'Platform GSTIN',
  codEnabled: 'Cash on delivery',
  walletRechargeEnabled: 'Wallet recharge',
  autoApproveProducts: 'Auto-approve products',
  supportEmail: 'Support email',
  scheduledReportsRecipients: 'Report recipients',
  welcomeOfferEnabled: 'Welcome offer',
};

const show = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (value === '' || value == null) return 'empty';
  return String(value).slice(0, 80);
};

/**
 * A security-style notice to every super admin when a sensitive platform setting changes,
 * so a change they did not make is noticed. `before` and `after` are the stored values.
 */
export async function notifySettingsChanged(
  actorId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedKeys: string[],
): Promise<void> {
  try {
    const rows = changedKeys.filter((key) => WATCHED[key]).map((key) => ({ label: WATCHED[key]!, value: `${show(before[key])} → ${show(after[key])}` }));
    if (rows.length === 0) return;
    const actor = await User.findByPk(actorId, { attributes: ['name', 'email'] });
    const stamp = Date.now();
    for (const adminId of await findSuperAdminUserIds()) {
      await notificationsService.enqueue({
        userId: adminId,
        type: 'ADMIN_SETTINGS_CHANGED',
        referenceType: 'PlatformSettings',
        referenceId: `${adminId}-${stamp}`,
        templateData: { actorName: actor?.name ?? actor?.email ?? 'An administrator', details: rows, detailsTitle: 'What changed' },
      });
    }
  } catch (error) {
    logger.warn('Settings changed email failed', { error: error instanceof Error ? error.message : error });
  }
}
