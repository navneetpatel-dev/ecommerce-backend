import { PlatformSetting } from '@database/models/platformSetting.model';

export type PlatformSettingsPayload = {
  defaultCommissionRate: number;
  /** Marketplace TCS percent on taxable value (0 disables). */
  tcsRatePercent: number;
  /** TDS u/s 194-O percent on taxable value at payout (0 disables). */
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
  pointsPerRupee: number;
  promotionalPointsTtlDays: number;
  refundSlaBusinessDays: number;
};

const SETTINGS_KEY = 'platform';

const DEFAULTS: PlatformSettingsPayload = {
  defaultCommissionRate: 10,
  tcsRatePercent: 1,
  tdsRatePercent: 1,
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
  pointsPerRupee: 1,
  promotionalPointsTtlDays: 0,
  refundSlaBusinessDays: 7,
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
    return next;
  },
};
