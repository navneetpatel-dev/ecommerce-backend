import { z } from 'zod';
import { ORDER_STATUS_VALUES } from '@core/constants/statuses';

export const UpdateSubOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  trackingId: z.string().optional(),
});

export type UpdateSubOrderStatusRequest = z.infer<typeof UpdateSubOrderStatusSchema>;

export const GetSubOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(ORDER_STATUS_VALUES).optional(),
  search: z.string().trim().optional(),
  vendorId: z.string().uuid().optional(),
});

export type GetSubOrdersQuery = z.infer<typeof GetSubOrdersQuerySchema>;

