import { z } from 'zod';

export const RecordWebVitalSchema = z
  .object({
    name: z.string().trim().min(1).max(16),
    value: z.coerce.number().finite(),
    rating: z.string().trim().max(32).optional(),
    path: z.string().trim().max(512).optional(),
    effectiveType: z.string().trim().max(16).optional(),
  })
  .strict();

export type RecordWebVitalRequest = z.infer<typeof RecordWebVitalSchema>;
