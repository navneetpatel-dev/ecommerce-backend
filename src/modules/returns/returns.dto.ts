import { z } from 'zod';

export const CreateReturnRequestSchema = z.object({
  orderItemId: z.string().uuid(),
  reasonCode: z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'OTHER']),
  reason: z.string().min(1),
});

export const TransitionReturnSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'CLOSED']),
});

export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
export type TransitionReturnRequest = z.infer<typeof TransitionReturnSchema>;
