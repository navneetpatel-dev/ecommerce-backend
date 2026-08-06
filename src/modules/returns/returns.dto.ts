import { z } from 'zod';
import { RETURN_REASON_VALUES, RETURN_STATUS_VALUES } from '@core/constants/statuses';

export const CreateReturnRequestSchema = z.object({
  orderItemId: z.string().uuid(),
  reasonCode: z.enum(RETURN_REASON_VALUES),
  reason: z.string().min(1),
});

export const TransitionReturnSchema = z.object({
  status: z.enum(RETURN_STATUS_VALUES),
});

export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
export type TransitionReturnRequest = z.infer<typeof TransitionReturnSchema>;
