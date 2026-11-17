import { ReturnRequest } from '@database/models/returnRequest.model';
import { RETURN_STATUS } from '@core/constants/statuses';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { returnsService } from './returns.service';
import { notifyReturnRequestedEvent } from '@modules/notifications/events/returnEvents';

export const RETURN_CANCEL_TOO_LATE =
  'This return has already been reviewed, so it cannot be cancelled here. Contact support if you need help.';

/**
 * The shopper withdraws their own return while nobody has acted on it yet. It is
 * removed the way staff remove an unapproved request, which frees the item for a
 * new return later.
 */
export async function cancelReturnByCustomer(returnId: string, userId: string): Promise<{ cancelled: true }> {
  const row = await ReturnRequest.findByPk(returnId);
  if (!row) throw new NotFoundError('ReturnRequest');
  if (row.userId !== userId) throw new ForbiddenError('You do not have access to this return');
  if (row.status !== RETURN_STATUS.REQUESTED) throw new ValidationError({ status: [RETURN_CANCEL_TOO_LATE] });
  await returnsService.delete(returnId, userId);
  return { cancelled: true };
}

/** Confirmation to the shopper that their return request arrived, and a request to the seller to review it. */
export async function notifyReturnRequested(_userId: string, created: { id: string; subOrderId?: string | null }) {
  void notifyReturnRequestedEvent(created.id);
}
