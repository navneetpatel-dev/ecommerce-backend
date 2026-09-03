import { z } from 'zod';
import { RETURN_REASON_VALUES, RETURN_STATUS_VALUES, RETURN_TYPE_VALUES } from '@core/constants/statuses';

export const CreateReturnRequestSchema = z.object({
  orderItemId: z.string().uuid(),
  reasonCode: z.enum(RETURN_REASON_VALUES),
  reason: z.string().min(1),
  type: z.enum(RETURN_TYPE_VALUES).default('REFUND'),
  /** Units to return; omit for full line quantity. */
  returnQuantity: z.number().int().min(1).optional(),
  /** Phase 2 attach — URLs from POST /api/uploads or /bulk (returns/photos). */
  photoUrls: z.array(z.string().url()).max(10).optional().default([]),
});

export const TransitionReturnSchema = z.object({
  status: z.enum(RETURN_STATUS_VALUES),
});

export type CreateReturnRequest = z.infer<typeof CreateReturnRequestSchema>;
export type TransitionReturnRequest = z.infer<typeof TransitionReturnSchema>;
