import { z } from 'zod';

export const CreateCouponSchema = z.object({
  code: z.string().min(1),
  type: z.enum(['PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'BOGO', 'TIERED', 'CASHBACK', 'BUNDLE']),
  value: z.number().optional(),
  maxDiscountCap: z.number().optional(),
  minOrderValue: z.number().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

export const ApplyCouponSchema = z.object({
  code: z.string(),
});

export type CreateCouponRequest = z.infer<typeof CreateCouponSchema>;
export type ApplyCouponRequest = z.infer<typeof ApplyCouponSchema>;
