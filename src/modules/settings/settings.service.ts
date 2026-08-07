import { PlatformSetting } from '@database/models/platformSetting.model';

export type PlatformSettingsPayload = {
  defaultCommissionRate: number;
  /** Marketplace TCS percent on taxable value (0 disables). */
  tcsRatePercent: number;
  /** TDS u/s 194-O percent on taxable value at payout (0 disables). */
  tdsRatePercent: number;
  autoApproveProducts: boolean;
  defaultReturnWindow: number;
  payoutCycle: string;
  freeShippingThreshold: number;
  /** Deducted from customer refund when reason does not refund original shipping. */
  returnShippingFee: number;
  supportEmail: string;
  supportHours: string;
};

const SETTINGS_KEY = 'platform';

const DEFAULTS: PlatformSettingsPayload = {
  defaultCommissionRate: 10,
  tcsRatePercent: 1,
  tdsRatePercent: 1,
  autoApproveProducts: false,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 500,
  returnShippingFee: 0,
  supportEmail: 'support@inkandbrass.example',
  supportHours: 'Mon–Sat, 9:00 AM–7:00 PM',
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
