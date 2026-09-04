import { z } from 'zod';

export const UpdateSettingsSchema = z.object({
  defaultCommissionRate: z.number().min(0).max(100),
  tcsRatePercent: z.number().min(0).max(100).default(1),
  tdsRatePercent: z.number().min(0).max(100).default(1),
  commissionGstRatePercent: z.number().min(0).max(100).default(18),
  platformGstin: z.string().max(20).default(''),
  platformLegalName: z.string().max(200).default(''),
  platformState: z.string().max(64).default(''),
  autoApproveProducts: z.boolean(),
  defaultReturnWindow: z.number().int().positive(),
  payoutCycle: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  freeShippingThreshold: z.number().min(0),
  returnShippingFee: z.number().min(0).default(0),
  supportEmail: z.string().email(),
  supportHours: z.string().min(1),
  /** Required on admin save so omitted fields cannot silently reset to defaults. */
  ticketReopenWindowDays: z.number().int().positive().max(365),
  bugVerifyWindowDays: z.number().int().positive().max(365),
  bugCloseWindowDays: z.number().int().positive().max(365),
  codEnabled: z.boolean().default(true),
  codMinOrderValue: z.number().min(0).default(0),
  codMaxOrderValue: z.number().min(0).nullable().default(null),
  walletRechargeEnabled: z.boolean().default(true),
  walletMinRechargeInr: z.number().min(1).default(1),
  walletMaxRechargeInr: z.number().min(1).default(10000),
  walletMaxBalancePoints: z.number().min(0).default(50000),
  walletRechargePresetsInr: z.array(z.number().min(1)).default([500, 1000, 2000, 5000]),
  pointsPerRupee: z.number().min(0.01).default(1),
  promotionalPointsTtlDays: z.number().int().min(0).default(0),
  refundSlaBusinessDays: z.number().int().positive().max(30).default(7),
  deliveryAgentPerTaskEarning: z.number().min(0).default(20),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsSchema>;
