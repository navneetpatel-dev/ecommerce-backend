// Orders module - Order creation and management
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  shippingAddressId: z.string().uuid(),
  couponId: z.string().uuid().optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']),
});

export const GetOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']).optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusSchema>;
export type GetOrdersQuery = z.infer<typeof GetOrdersQuerySchema>;
