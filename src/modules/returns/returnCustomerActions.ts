import { ReturnRequest } from '@database/models/returnRequest.model';
import { SubOrder } from '@database/models/subOrder.model';
import { RETURN_STATUS } from '@core/constants/statuses';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { notificationsService } from '@modules/notifications/notifications.service';
import { customerOrderUrl } from '@modules/notifications/portalLinks';
import { returnsService } from './returns.service';

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

/** Confirmation to the shopper that their return request arrived. */
export async function notifyReturnRequested(userId: string, created: { id: string; subOrderId?: string | null }) {
  const sub = created.subOrderId ? await SubOrder.findByPk(created.subOrderId, { attributes: ['orderId'] }) : null;
  const orderId = sub?.orderId ?? '';
  void notificationsService.sendOrderReturned(userId, created.id, {
    status: RETURN_STATUS.REQUESTED,
    statusText: 'request received. We will email you when the seller reviews it',
    orderId,
    orderNumber: orderId.slice(0, 8).toUpperCase(),
    actionUrl: customerOrderUrl(orderId),
  });
}
