import { PlatformSetting } from '@database/models/platformSetting.model';
import { sequelize } from '@database/models';
import { ValidationError } from '@core/errors/ValidationError';
import { reportEngine } from '@modules/reports/engine/reportEngine';
import { logAudit } from '@modules/audit/audit.service';
import { notifySettingsChanged } from '@modules/notifications/events/adminEvents';

export type PlatformSettingsPayload = {
  defaultCommissionRate: number;
  /**
   * Marketplace TCS percent on taxable value (0 disables). Quoted at checkout and taken
   * at the rate in force when the part is dispatched (invoiced).
   */
  tcsRatePercent: number;
  /**
   * TDS u/s 194-O percent on the sale value excluding GST (0 disables). Withheld at
   * payout at the rate in force then; a sale exempt at checkout (194-O(4)) stays exempt.
   */
  tdsRatePercent: number;
  /**
   * 194-O(4) exemption, in rupees: a sole proprietor whose financial-year gross sales
   * through the platform stay within this amount has no TDS deducted (0 disables).
   */
  tds194oExemptionThreshold: number;
  /** GST % on marketplace commission invoices to vendors (SAC 9985). */
  commissionGstRatePercent: number;
  /** Ecommerce operator GSTIN for commission invoices / GSTR-8. */
  platformGstin: string;
  platformLegalName: string;
  platformState: string;
  autoApproveProducts: boolean;
  autoApproveReviews: boolean;
  autoApproveQuestions: boolean;
  defaultReturnWindow: number;
  payoutCycle: string;
  freeShippingThreshold: number;
  /** Deducted from customer refund when reason does not refund original shipping. */
  returnShippingFee: number;
  supportEmail: string;
  supportHours: string;
  /** Days after resolve during which a customer may reopen a support ticket. */
  ticketReopenWindowDays: number;
  /** Days after FIXED before a bug report auto-transitions to VERIFIED. */
  bugVerifyWindowDays: number;
  /** Days after VERIFIED before a bug report auto-transitions to CLOSED. */
  bugCloseWindowDays: number;
  codEnabled: boolean;
  codMinOrderValue: number;
  codMaxOrderValue: number | null;
  walletRechargeEnabled: boolean;
  walletMinRechargeInr: number;
  walletMaxRechargeInr: number;
  walletMaxBalancePoints: number;
  walletRechargePresetsInr: number[];
  promotionalPointsTtlDays: number;
  refundSlaBusinessDays: number;
  /** Master switch for the automated weekly admin report email digest. */
  scheduledReportsEnabled: boolean;
  /** Report catalog `type` keys to include in the digest. */
  scheduledReportsTypes: string[];
  /** Explicit recipient email addresses (v1: no role-based fan-out). */
  scheduledReportsRecipients: string[];
  /** 0=Sunday..6=Saturday. */
  scheduledReportsDayOfWeek: number;
  scheduledReportsHourUtc: number;
  /** Maintenance mode (B-11): while on, the storefront sends shoppers to /maintenance. */
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
  /** When the store expects to be back (ISO time), shown on the maintenance page. */
  maintenanceUntil: string | null;
  /** First-order welcome code emailed when a shopper verifies their email. */
  welcomeOfferEnabled: boolean;
  welcomeOfferPercent: number;
  welcomeOfferMaxDiscount: number;
  welcomeOfferMinOrder: number;
  welcomeOfferValidDays: number;
};

const SETTINGS_KEY = 'platform';

const DEFAULTS: PlatformSettingsPayload = {
  defaultCommissionRate: 10,
  // GST s.52 TCS (0.5% from 10 Jul 2024) and 194-O TDS (0.1% from 1 Oct 2024).
  tcsRatePercent: 0.5,
  tdsRatePercent: 0.1,
  tds194oExemptionThreshold: 500000,
  commissionGstRatePercent: 18,
  platformGstin: '',
  platformLegalName: '',
  platformState: '',
  autoApproveProducts: false,
  autoApproveReviews: true,
  autoApproveQuestions: true,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 500,
  returnShippingFee: 0,
  supportEmail: 'support@inkandbrass.example',
  supportHours: 'Mon–Sat, 9:00 AM–7:00 PM',
  ticketReopenWindowDays: 7,
  bugVerifyWindowDays: 7,
  bugCloseWindowDays: 7,
  codEnabled: true,
  codMinOrderValue: 0,
  codMaxOrderValue: null,
  walletRechargeEnabled: true,
  walletMinRechargeInr: 1,
  walletMaxRechargeInr: 10000,
  walletMaxBalancePoints: 50000,
  walletRechargePresetsInr: [500, 1000, 2000, 5000],
  promotionalPointsTtlDays: 0,
  refundSlaBusinessDays: 7,
  scheduledReportsEnabled: false,
  scheduledReportsTypes: ['reconciliation', 'gmv-sales'],
  scheduledReportsRecipients: [],
  scheduledReportsDayOfWeek: 1,
  scheduledReportsHourUtc: 6,
  maintenanceEnabled: false,
  maintenanceMessage: '',
  maintenanceUntil: null,
  welcomeOfferEnabled: true,
  welcomeOfferPercent: 10,
  welcomeOfferMaxDiscount: 200,
  welcomeOfferMinOrder: 0,
  welcomeOfferValidDays: 30,
};

/** Presets outside the stored cap are a broken config; raise the cap so they can be paid. */
function alignWalletRecharge(settings: PlatformSettingsPayload): PlatformSettingsPayload {
  const minInr = settings.walletMinRechargeInr;
  const presets = (settings.walletRechargePresetsInr ?? []).filter((amount) => Number.isFinite(amount) && amount >= minInr);
  const highestPreset = presets.reduce((highest, amount) => Math.max(highest, amount), minInr);
  const maxInr = Math.max(settings.walletMaxRechargeInr, highestPreset);
  return {
    ...settings,
    walletMaxRechargeInr: maxInr,
    walletRechargePresetsInr: presets.filter((amount) => amount <= maxInr),
  };
}

/** Unique, ascending recharge presets so the storefront renders a clean list. */
function normalizePresets(presets: number[]): number[] {
  return [...new Set(presets.filter((amount) => Number.isFinite(amount) && amount > 0))].sort((a, b) => a - b);
}

function normalizeRecipients(recipients: string[]): string[] {
  return [...new Set(recipients.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

/** Keys whose stored value differs from the incoming one, for the audit trail. */
function changedKeys(before: PlatformSettingsPayload, after: PlatformSettingsPayload): string[] {
  return (Object.keys(after) as Array<keyof PlatformSettingsPayload>).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

export const settingsService = {
  async getPlatformSettings(): Promise<PlatformSettingsPayload> {
    const row = await PlatformSetting.findOne({ where: { key: SETTINGS_KEY } });
    const merged = row ? { ...DEFAULTS, ...(row.value as Partial<PlatformSettingsPayload>) } : { ...DEFAULTS };
    return alignWalletRecharge(merged);
  },

  /**
   * Saves the platform settings and records who changed what. The write and the audit
   * row share a transaction so a failed audit never leaves a silent, unaudited change,
   * and the response is the same (wallet-aligned) view every reader gets afterwards.
   */
  async updatePlatformSettings(value: PlatformSettingsPayload, actorId: string): Promise<PlatformSettingsPayload> {
    const schedulable = new Set(reportEngine.schedulableCatalog().map((report) => report.type));
    const unknownReports = value.scheduledReportsTypes.filter((type) => !schedulable.has(type));
    if (unknownReports.length > 0) {
      throw new ValidationError(`These reports cannot be scheduled: ${unknownReports.join(', ')}`);
    }

    const next: PlatformSettingsPayload = alignWalletRecharge({
      ...DEFAULTS,
      ...value,
      walletRechargePresetsInr: normalizePresets(value.walletRechargePresetsInr ?? DEFAULTS.walletRechargePresetsInr),
      scheduledReportsRecipients: normalizeRecipients(value.scheduledReportsRecipients ?? []),
      scheduledReportsTypes: [...new Set(value.scheduledReportsTypes ?? [])],
    });

    await sequelize.transaction(async (transaction) => {
      const row = await PlatformSetting.findOne({ where: { key: SETTINGS_KEY }, transaction, lock: transaction.LOCK.UPDATE });
      const before = row ? { ...DEFAULTS, ...(row.value as Partial<PlatformSettingsPayload>) } : { ...DEFAULTS };
      const saved = row
        ? await row.update({ value: next as unknown as Record<string, unknown>, updatedBy: actorId }, { transaction })
        : await PlatformSetting.create(
            { key: SETTINGS_KEY, value: next as unknown as Record<string, unknown>, updatedBy: actorId, createdBy: actorId },
            { transaction },
          );

      await logAudit({
        actorId,
        action: 'PLATFORM_SETTINGS_UPDATED',
        entityType: 'PlatformSetting',
        entityId: saved.id,
        metadata: { keysUpdated: changedKeys(before, next) },
        transaction,
      });
      transaction.afterCommit(() => void notifySettingsChanged(actorId, before, next, changedKeys(before, next)));
    });

    return next;
  },
};
