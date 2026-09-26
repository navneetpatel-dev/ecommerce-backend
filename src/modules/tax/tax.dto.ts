import { z } from 'zod';

/** Optional per-piece price band: both fields set, or neither. */
const priceBandFields = {
  /** Per-piece value in ₹ above which `gstPercentageAbove` applies. */
  priceBandThreshold: z.number().positive().nullable().optional(),
  gstPercentageAbove: z.number().min(0).max(100).nullable().optional(),
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
    categoryId: z.string().uuid().optional(),
    hsnCode: z.string().optional(),
    gstPercentage: z.number().min(0).max(100),
    ...priceBandFields,
  })
  .superRefine(assertPriceBand);

export const UpdateTaxRuleSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    hsnCode: z.string().optional(),
    gstPercentage: z.number().min(0).max(100).optional(),
    ...priceBandFields,
  })
  .superRefine(assertPriceBand);

export type CreateTaxRuleRequest = z.infer<typeof CreateTaxRuleSchema>;
export type UpdateTaxRuleRequest = z.infer<typeof UpdateTaxRuleSchema>;
