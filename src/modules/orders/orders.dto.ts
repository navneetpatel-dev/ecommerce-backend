// Orders module - Order creation and management
import { z } from 'zod';
import { ORDER_STATUS_VALUES } from '@core/constants/statuses';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@core/constants/http';

export const CreateOrderSchema = z.object({
  shippingAddressId: z.string().uuid(),
  couponId: z.string().uuid().optional(),
});

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
});

export const GetOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  search: z.string().trim().optional(),
  /** Admin-only: filter orders belonging to a specific user (e.g. admin user detail page). Ignored for non-admin callers. */
  userId: z.string().uuid().optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusSchema>;
export type GetOrdersQuery = z.infer<typeof GetOrdersQuerySchema>;
