import { z } from 'zod';
import { MAX_CART_LINE_QUANTITY } from './cart.constants';

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().positive().max(MAX_CART_LINE_QUANTITY),
});

export const AddToCartSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().max(MAX_CART_LINE_QUANTITY).default(1),
});

export type AddToCartRequest = z.infer<typeof AddToCartSchema>;
export type UpdateCartItemRequest = z.infer<typeof UpdateCartItemSchema>;
