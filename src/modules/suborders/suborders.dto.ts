import { z } from 'zod';
import { ORDER_STATUS_VALUES } from '@core/constants/statuses';

export const UpdateSubOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUS_VALUES),
  trackingId: z.string().optional(),
});

export type UpdateSubOrderStatusRequest = z.infer<typeof UpdateSubOrderStatusSchema>;
