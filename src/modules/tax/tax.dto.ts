import { z } from 'zod';

export const CreateTaxRuleSchema = z.object({
  categoryId: z.string().uuid().optional(),
  hsnCode: z.string().optional(),
  gstPercentage: z.number().min(0).max(100),
});

export const UpdateTaxRuleSchema = z.object({
  categoryId: z.string().uuid().optional(),
  hsnCode: z.string().optional(),
  gstPercentage: z.number().min(0).max(100).optional(),
});

export type CreateTaxRuleRequest = z.infer<typeof CreateTaxRuleSchema>;
export type UpdateTaxRuleRequest = z.infer<typeof UpdateTaxRuleSchema>;
