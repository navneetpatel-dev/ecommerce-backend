import { z } from 'zod';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PRODUCT_FIELD_LIMITS } from '@core/constants/product';
import { HSN_CODE_PATTERN } from '@core/constants/tax';
import { pageLimitQuerySchema } from '@core/http/pagination';

const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

/** A GST percentage: 0 to 100, at most two decimals (the database keeps two). */
const gstPercent = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, 'Use at most two decimals');

const hsnCode = z.preprocess(
  emptyToNull,
  z.string().trim().regex(HSN_CODE_PATTERN, ERROR_MESSAGES.TAX_HSN_INVALID).nullable().optional(),
);

/** Optional per-piece price band: both fields set, or neither. */
const priceBandFields = {
  /** Per-piece value in ₹ above which `gstPercentageAbove` applies. */
  priceBandThreshold: z.number().positive().max(PRODUCT_FIELD_LIMITS.PRICE_MAX).nullable().optional(),
  gstPercentageAbove: gstPercent.nullable().optional(),
};

function assertPriceBand(
  data: { priceBandThreshold?: number | null; gstPercentageAbove?: number | null },
  ctx: z.RefinementCtx,
) {
  const hasThreshold = data.priceBandThreshold != null;
  const hasRate = data.gstPercentageAbove != null;
  if (hasThreshold !== hasRate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasThreshold ? 'gstPercentageAbove' : 'priceBandThreshold'],
      message: 'Set both the price threshold and the GST % above it, or neither',
    });
  }
}

export const CreateTaxRuleSchema = z
  .object({
    /** Empty: the platform default rule. */
    categoryId: z.string().uuid().nullable().optional(),
    hsnCode,
    gstPercentage: gstPercent,
    ...priceBandFields,
  })
  .superRefine(assertPriceBand);

export const UpdateTaxRuleSchema = z
  .object({
    /** `null`: make this the platform default rule. */
    categoryId: z.string().uuid().nullable().optional(),
    hsnCode,
    gstPercentage: gstPercent.optional(),
    ...priceBandFields,
  })
  .superRefine(assertPriceBand);

/** The rules list: server-side filters so totals and pages are right. */
export const TaxRuleListQuerySchema = pageLimitQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  gstPercentage: z.coerce.number().min(0).max(100).optional(),
  hasBand: z.enum(['YES', 'NO']).optional(),
  scope: z.enum(['default', 'category']).optional(),
  categoryId: z.string().uuid().optional(),
});

export const EffectiveRuleQuerySchema = z.object({ categoryId: z.string().uuid() });

export const DeleteTaxRuleQuerySchema = z.object({
  /** Needed to delete the default rule (it changes the GST of every category without its own rule). */
  force: z.enum(['true', 'false']).optional(),
});

/** A rule change being considered, to show what it would take off sale before it is saved. */
export const TaxRuleImpactSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), rule: CreateTaxRuleSchema }),
  z.object({ action: z.literal('update'), ruleId: z.string().uuid(), rule: UpdateTaxRuleSchema }),
  z.object({ action: z.literal('delete'), ruleId: z.string().uuid() }),
]);
export type TaxRuleImpactRequest = z.infer<typeof TaxRuleImpactSchema>;

export type CreateTaxRuleRequest = z.infer<typeof CreateTaxRuleSchema>;
export type UpdateTaxRuleRequest = z.infer<typeof UpdateTaxRuleSchema>;
export type TaxRuleListQuery = z.infer<typeof TaxRuleListQuerySchema>;
