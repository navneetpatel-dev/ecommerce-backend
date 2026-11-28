import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';

export const UpdateStockSchema = z.object({
  stock: z.number().int().nonnegative(),
  /** The stock the editor showed: the edit is applied as a change on top of the stock now. */
  expectedStock: z.number().int().nonnegative(),
});

export type UpdateStockRequest = z.infer<typeof UpdateStockSchema>;

/** The low-stock list. Without `threshold`, each variant's own alert level decides. */
export const LowStockQuerySchema = pageLimitQuerySchema.extend({
  threshold: z.coerce.number().int().nonnegative().optional(),
  search: z.string().trim().max(100).optional(),
  level: z.enum(['OUT_OF_STOCK', 'CRITICAL']).optional(),
  sort: z.enum(['stock_asc', 'stock_desc', 'name_asc']).default('stock_asc'),
  vendorId: z.string().uuid().optional(),
});

export type LowStockQuery = z.infer<typeof LowStockQuerySchema>;

export const CreateStockAlertSchema = z.object({
  variantId: z.string().uuid(),
  guestEmail: z.string().email().optional(),
});

export type CreateStockAlertRequest = z.infer<typeof CreateStockAlertSchema>;

export const CancelStockAlertSchema = z.object({ token: z.string().min(1).max(2000) });
