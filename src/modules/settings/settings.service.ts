import { PlatformSetting } from '@database/models/platformSetting.model';
import { logAudit } from '@modules/audit/audit.service';

export type PlatformSettingsPayload = {
  defaultCommissionRate: number;
  /** Marketplace TCS percent on taxable value (0 disables). */
  tcsRatePercent: number;
  /**
   * TDS u/s 194-O percent on the sale value excluding GST (0 disables). Frozen on each
   * sale at checkout and withheld at payout, so a change applies to later sales only.
   */
  tdsRatePercent: number;
  /** GST % on marketplace commission invoices to vendors (SAC 9985). */
  commissionGstRatePercent: number;
  /** Ecommerce operator GSTIN for commission invoices / GSTR-8. */
  platformGstin: string;
  platformLegalName: string;
  platformState: string;
  autoApproveProducts: boolean;
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
  /** Flat estimate paid per completed delivery/pickup task, for the agent shift summary. */
  deliveryAgentPerTaskEarning: number;
  /** Master switch for the automated weekly admin report email digest. */
  scheduledReportsEnabled: boolean;
  /** Report catalog `type` keys to include in the digest. */
  scheduledReportsTypes: string[];
  /** Explicit recipient email addresses (v1: no role-based fan-out). */
  scheduledReportsRecipients: string[];
  /** 0=Sunday..6=Saturday. */
  scheduledReportsDayOfWeek: number;
  scheduledReportsHourUtc: number;
};

const SETTINGS_KEY = 'platform';

const DEFAULTS: PlatformSettingsPayload = {
  defaultCommissionRate: 10,
  // GST s.52 TCS (0.5% from 10 Jul 2024) and 194-O TDS (0.1% from 1 Oct 2024).
  tcsRatePercent: 0.5,
  tdsRatePercent: 0.1,
  commissionGstRatePercent: 18,
  platformGstin: '',
  platformLegalName: '',
  platformState: '',
  autoApproveProducts: false,
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
  deliveryAgentPerTaskEarning: 20,
  scheduledReportsEnabled: false,
  scheduledReportsTypes: ['reconciliation', 'gmv-sales'],
  scheduledReportsRecipients: [],
  scheduledReportsDayOfWeek: 1,
  scheduledReportsHourUtc: 6,
};

export const settingsService = {
  async getPlatformSettings(): Promise<PlatformSettingsPayload> {
    const row = await PlatformSetting.findOne({ where: { key: SETTINGS_KEY } });
    if (!row) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(row.value as Partial<PlatformSettingsPayload>) };
  },

  async updatePlatformSettings(
    value: PlatformSettingsPayload,
    actorId: string,
  ): Promise<PlatformSettingsPayload> {
    const next = { ...DEFAULTS, ...value };
    await PlatformSetting.upsert({
      key: SETTINGS_KEY,
      value: next as unknown as Record<string, unknown>,
      updatedBy: actorId,
      createdBy: actorId,
    });

    await logAudit({
      actorId,
      action: 'PLATFORM_SETTINGS_UPDATED',
      entityType: 'PlatformSetting',
      entityId: SETTINGS_KEY,
      metadata: { keysUpdated: Object.keys(value) },
    });

    return next;
  },
};
