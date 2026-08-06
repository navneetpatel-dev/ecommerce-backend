import { PlatformSetting } from '@database/models/platformSetting.model';

export type PlatformSettingsPayload = {
  defaultCommissionRate: number;
  autoApproveProducts: boolean;
  defaultReturnWindow: number;
  payoutCycle: string;
  freeShippingThreshold: number;
  supportEmail: string;
  supportHours: string;
};

const SETTINGS_KEY = 'platform';

const DEFAULTS: PlatformSettingsPayload = {
  defaultCommissionRate: 10,
  autoApproveProducts: false,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 500,
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
