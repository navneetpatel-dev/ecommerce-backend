import { z } from 'zod';

export const UpdateSettingsSchema = z.object({
  defaultCommissionRate: z.number().min(0).max(100),
  tcsRatePercent: z.number().min(0).max(100).default(1),
  tdsRatePercent: z.number().min(0).max(100).default(1),
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
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsSchema>;
