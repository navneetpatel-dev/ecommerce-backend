import { z } from 'zod';

export const UpdateSettingsSchema = z.object({
  defaultCommissionRate: z.number().min(0).max(100),
  autoApproveProducts: z.boolean(),
  defaultReturnWindow: z.number().int().positive(),
  payoutCycle: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  freeShippingThreshold: z.number().min(0),
  supportEmail: z.string().email(),
  supportHours: z.string().min(1),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsSchema>;
