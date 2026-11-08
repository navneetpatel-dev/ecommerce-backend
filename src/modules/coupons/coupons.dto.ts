import { z } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';
import { refineCouponShape, type CouponShape } from './couponShape';

export type { CouponShape } from './couponShape';
import { COUPON_STATUS_VALUES } from '@core/constants/statuses';

import { COUPON_TYPES } from './couponShape';

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
    .max(64, 'Code must be 64 characters or fewer')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, hyphens and underscores'),
  type: z.enum(COUPON_TYPES, { message: 'Type is required' }),
  value: z.number().nonnegative('Value cannot be negative').optional().nullable(),
  maxDiscountCap: z.number().positive('Max discount must be greater than zero').optional().nullable(),
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
  showInOffers: z.boolean().optional(),
});

const refineNewCoupon = (data: CouponShape, ctx: z.RefinementCtx) => refineCouponShape(data, ctx);

export const CreateCouponSchema = couponObjectSchema
  .extend({ status: z.enum(['DRAFT', 'ACTIVE']).optional() })
  .superRefine(refineNewCoupon);

/** Partial on purpose: the service checks the merged coupon with `assertValidCouponShape`. */
export const UpdateCouponSchema = couponObjectSchema.partial();

/** Throws a validation error when an edit would leave the coupon invalid (see updateCoupon). */
export function assertValidCouponShape(data: CouponShape, opts: { endMustBeFuture: boolean }): void {
  const result = z
    .custom<CouponShape>()
    .superRefine((value, ctx) => refineCouponShape(value, ctx, opts))
    .safeParse(data);
  if (!result.success) throw new ValidationError(result.error.flatten());
}

export const ApplyCouponSchema = z.object({
  code: z.string().trim().min(1, 'Code is required'),
});

/** DELETE /coupons/remove?code=XYZ — omit `code` to clear the entire stack. */
export const RemoveCouponQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
});

export const StatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT', 'REJECTED', 'PENDING_APPROVAL']),
    /** Why it was rejected: shown to the vendor. */
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'REJECTED' && !data.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Give a reason for rejecting this coupon' });
    }
  });

export const BatchStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED']),
});

export const EligibleCouponsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});

export const PublicEligibleCouponsQuerySchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(20).optional(),
});

// Every bulk code is single-use, so the template has no total limit.
const templateObjectSchema = couponObjectSchema
  .omit({ code: true, usageLimitTotal: true, showInOffers: true })
  .extend({ status: z.enum(['DRAFT', 'ACTIVE']).optional() });

export const BulkGenerateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  count: z.number().int().min(1).max(500),
  prefix: z
    .string()
    .trim()
    .max(8)
    .regex(/^[A-Za-z0-9-]*$/, 'Use only letters, numbers and hyphens')
    .optional(),
  template: templateObjectSchema.superRefine(refineNewCoupon),
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
  /** Part of a coupon code, any case. */
  search: z.string().trim().min(1).max(64).optional(),
  /** Leave bulk-generated codes out of the list. */
  excludeBatches: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

export type CreateCouponRequest = z.infer<typeof CreateCouponSchema>;
export type UpdateCouponRequest = z.infer<typeof UpdateCouponSchema>;
export type ApplyCouponRequest = z.infer<typeof ApplyCouponSchema>;
export type BulkGenerateRequest = z.infer<typeof BulkGenerateSchema>;
export type ListCouponsQuery = z.infer<typeof ListCouponsQuerySchema>;
export type CouponStatusRequest = z.infer<typeof StatusSchema>;
