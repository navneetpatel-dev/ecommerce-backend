import { z } from 'zod'

const COUPON_TYPES = [
  'PERCENTAGE',
  'FLAT',
  'FREE_SHIPPING',
  'BOGO',
  'TIERED',
  'CASHBACK',
  'BUNDLE',
] as const

const TYPES_REQUIRING_VALUE = new Set<(typeof COUPON_TYPES)[number]>([
  'PERCENTAGE',
  'FLAT',
  'CASHBACK',
])

/** Shared coupon create rules — keep FE schema in sync with backend DTO. */
export const CreateCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Code is required')
      .max(64, 'Code must be 64 characters or fewer'),
    type: z.enum(COUPON_TYPES, { message: 'Type is required' }),
    value: z.number().nonnegative('Value cannot be negative').optional(),
    maxDiscountCap: z.number().nonnegative('Max discount cannot be negative').optional(),
    minOrderValue: z.number().nonnegative('Min order value cannot be negative').optional(),
    startDate: z
      .string()
      .min(1, 'Start date is required')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Start date is invalid'),
    endDate: z
      .string()
      .min(1, 'End date is required')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'End date is invalid'),
  })
  .superRefine((data, ctx) => {
    if (TYPES_REQUIRING_VALUE.has(data.type) && (data.value == null || Number.isNaN(data.value))) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Value is required for this coupon type',
      })
    }

    if (data.type === 'PERCENTAGE' && data.value != null && data.value > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Percentage value cannot exceed 100',
      })
    }

    const start = Date.parse(data.startDate)
    const end = Date.parse(data.endDate)
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be after start date',
      })
    }
  })

export const ApplyCouponSchema = z.object({
  code: z.string().trim().min(1, 'Code is required'),
})

export type CreateCouponRequest = z.infer<typeof CreateCouponSchema>
export type ApplyCouponRequest = z.infer<typeof ApplyCouponSchema>
