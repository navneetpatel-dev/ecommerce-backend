import { z } from 'zod';
import { COUPON_STATUS_VALUES, DISCOUNT_BEARER_VALUES } from '@core/constants/statuses';

const COUPON_TYPES = [
  'PERCENTAGE',
  'FLAT',
  'FREE_SHIPPING',
  'BOGO',
  'TIERED',
  'CASHBACK',
  'BUNDLE',
] as const;

const TYPES_REQUIRING_VALUE = new Set<(typeof COUPON_TYPES)[number]>([
  'PERCENTAGE',
  'FLAT',
  'CASHBACK',
  'BUNDLE',
]);

const ScopeSchema = z.object({
  type: z.enum(['all', 'vendor', 'product', 'category']),
  ids: z.array(z.string().uuid()).default([]),
});

const ExcludedItemsSchema = z
  .object({
    productIds: z.array(z.string().uuid()).optional(),
    categoryIds: z.array(z.string().uuid()).optional(),
  })
  .optional();

const UserRestrictionSchema = z
  .object({
    type: z.enum(['all', 'firstOrder', 'specific', 'segment']),
    value: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .optional();

const CouponConfigSchema = z
  .object({
    tiers: z
      .array(
        z.object({
          minSubtotal: z.number().nonnegative(),
          percent: z.number().positive().max(100),
        }),
      )
      .optional(),
    bundleProductIds: z.array(z.string().uuid()).optional(),
  })
  .optional();

const couponObjectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(64, 'Code must be 64 characters or fewer'),
  type: z.enum(COUPON_TYPES, { message: 'Type is required' }),
  value: z.number().nonnegative('Value cannot be negative').optional().nullable(),
  maxDiscountCap: z.number().nonnegative('Max discount cannot be negative').optional().nullable(),
  minOrderValue: z.number().nonnegative('Min order value cannot be negative').optional().nullable(),
  minQuantity: z.number().int().nonnegative().optional().nullable(),
  applicableScope: ScopeSchema.optional(),
  excludedItems: ExcludedItemsSchema,
  userRestriction: UserRestrictionSchema,
  config: CouponConfigSchema,
  usageLimitTotal: z.number().int().positive().optional().nullable(),
  usageLimitPerUser: z.number().int().positive().optional().nullable(),
  startDate: z
    .string()
    .min(1, 'Start date is required')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Start date is invalid'),
  endDate: z
    .string()
    .min(1, 'End date is required')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'End date is invalid'),
  stackable: z.boolean().optional(),
  priority: z.number().int().optional(),
  vendorId: z.string().uuid().optional().nullable(),
  discountBearer: z.enum(DISCOUNT_BEARER_VALUES).optional(),
  status: z.enum(COUPON_STATUS_VALUES).optional(),
});

function refineCouponDatesAndValue(
  data: {
    type: (typeof COUPON_TYPES)[number];
    value?: number | null;
    startDate: string;
    endDate: string;
    config?: {
      tiers?: Array<{ minSubtotal: number; percent: number }>;
      bundleProductIds?: string[];
    };
  },
  ctx: z.RefinementCtx,
) {
  if (TYPES_REQUIRING_VALUE.has(data.type) && (data.value == null || Number.isNaN(data.value))) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Value is required for this coupon type',
    });
  }

  if (data.type === 'PERCENTAGE' && data.value != null && data.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Percentage value cannot exceed 100',
    });
  }

  if (data.type === 'TIERED') {
    const tiers = data.config?.tiers ?? [];
    const hasValue = data.value != null && !Number.isNaN(data.value) && data.value > 0;
    if (tiers.length === 0 && !hasValue) {
      ctx.addIssue({
        code: 'custom',
        path: ['config'],
        message: 'Tiered coupons require tiers or a percentage value',
      });
    }
  }

  if (data.type === 'BUNDLE') {
    const ids = data.config?.bundleProductIds ?? [];
    if (ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'bundleProductIds'],
        message: 'Bundle coupons require at least one product',
      });
    }
  }

  const start = Date.parse(data.startDate);
  const end = Date.parse(data.endDate);
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be after start date',
    });
  }
}

export const CreateCouponSchema = couponObjectSchema.superRefine(refineCouponDatesAndValue);

export const UpdateCouponSchema = couponObjectSchema
  .partial()
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.type) {
      refineCouponDatesAndValue(
        {
          type: data.type,
          value: data.value,
          startDate: data.startDate,
          endDate: data.endDate,
          config: data.config,
        },
        ctx,
      );
    }
  });

export const ApplyCouponSchema = z.object({
  code: z.string().trim().min(1, 'Code is required'),
});

export const StatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT', 'REJECTED']),
});

export const EligibleCouponsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});

export const PublicEligibleCouponsQuerySchema = z.object({
  productId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});

const templateObjectSchema = couponObjectSchema.omit({ code: true });

export const BulkGenerateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  count: z.number().int().min(1).max(500),
  prefix: z.string().trim().max(8).optional(),
  template: templateObjectSchema.superRefine(refineCouponDatesAndValue),
});

export const ListCouponsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.enum(COUPON_STATUS_VALUES).optional(),
  vendorId: z.string().uuid().optional(),
  /** When true, only vendor-created coupons; when false, only platform-wide. */
  vendorScoped: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined
      return value === true || value === 'true'
    }),
  type: z.enum(COUPON_TYPES).optional(),
  batchId: z.string().uuid().optional(),
});

export type CreateCouponRequest = z.infer<typeof CreateCouponSchema>;
export type UpdateCouponRequest = z.infer<typeof UpdateCouponSchema>;
export type ApplyCouponRequest = z.infer<typeof ApplyCouponSchema>;
export type BulkGenerateRequest = z.infer<typeof BulkGenerateSchema>;
export type ListCouponsQuery = z.infer<typeof ListCouponsQuerySchema>;
export type CouponStatusRequest = z.infer<typeof StatusSchema>;
