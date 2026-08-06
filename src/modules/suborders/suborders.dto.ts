import { z } from 'zod';

export const UpdateSubOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  trackingId: z.string().optional(),
});

export type UpdateSubOrderStatusRequest = z.infer<typeof UpdateSubOrderStatusSchema>;
