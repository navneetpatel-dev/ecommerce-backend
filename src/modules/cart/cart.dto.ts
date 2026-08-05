import { z } from 'zod';

export const AddToCartSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
});

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().positive(),
});

export type AddToCartRequest = z.infer<typeof AddToCartSchema>;
export type UpdateCartItemRequest = z.infer<typeof UpdateCartItemSchema>;
