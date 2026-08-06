import { z } from 'zod';

export const UpdateStockSchema = z.object({
  stock: z.number().int().nonnegative(),
});

export type UpdateStockRequest = z.infer<typeof UpdateStockSchema>;
