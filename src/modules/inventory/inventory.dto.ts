import { z } from 'zod';

export const UpdateStockSchema = z.object({
  stock: z.number().int().nonnegative(),
});

export type UpdateStockRequest = z.infer<typeof UpdateStockSchema>;

export const CreateStockAlertSchema = z.object({
  variantId: z.string().uuid(),
  guestEmail: z.string().email().optional(),
});

export type CreateStockAlertRequest = z.infer<typeof CreateStockAlertSchema>;

export const DeleteStockAlertQuerySchema = z.object({
  guestEmail: z.string().email().optional(),
});

export type DeleteStockAlertQuery = z.infer<typeof DeleteStockAlertQuerySchema>;
