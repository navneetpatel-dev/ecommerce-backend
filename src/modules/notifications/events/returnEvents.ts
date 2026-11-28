import { logger } from '@core/logger';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { RETURN_STATUS } from '@core/constants/statuses';
import { orderReference } from '@modules/orders/orderReference';
import { notificationsService } from '../notifications.service';
import { findSuperAdminUserIds, findVendorOwnerUserId } from '../orderNotifications';
import type { NotificationType } from '@database/models/notificationLog.model';

type Loaded = { ret: ReturnRequest; item: OrderItem | null; order: Order | null; vendorId: string | null };

async function load(returnId: string): Promise<Loaded | null> {
  const ret = await ReturnRequest.findByPk(returnId);
  if (!ret) return null;
  const item = await OrderItem.findByPk(ret.orderItemId);
  const sub = await SubOrder.findByPk(ret.subOrderId, { attributes: ['id', 'orderId', 'vendorId'] });
  const order = sub ? await Order.findByPk(sub.orderId, { attributes: ['id', 'userId'] }) : null;
  return { ret, item, order, vendorId: sub?.vendorId ?? null };
}

const baseData = ({ ret, item, order }: Loaded) => ({
  returnId: ret.id,
  orderId: order?.id ?? '',
  orderNumber: order ? orderReference(order.id) : '',
  productName: item?.productName ?? '',
  reason: ret.reason,
  details: [
    ...(item ? [{ label: 'Item', value: `${item.productName} × ${ret.returnQuantity ?? item.quantity}` }] : []),
    { label: 'Reason', value: ret.reason },
  ],
  detailsTitle: 'Return details',
});

const STATUS_TYPE: Partial<Record<string, NotificationType>> = {
  [RETURN_STATUS.APPROVED]: 'RETURN_APPROVED',
  [RETURN_STATUS.REJECTED]: 'RETURN_REJECTED',
  [RETURN_STATUS.PICKUP_SCHEDULED]: 'RETURN_PICKUP_SCHEDULED',
  [RETURN_STATUS.RECEIVED]: 'RETURN_RECEIVED',
  [RETURN_STATUS.CLOSED]: 'ORDER_RETURNED',
};

/** The shopper's return moved to a new stage: one email per stage, worded for that stage. */
export async function notifyReturnStatus(returnId: string, status: string, rejectionReason?: string | null): Promise<void> {
  try {
    const type = STATUS_TYPE[status];
    const loaded = type ? await load(returnId) : null;
    if (!type || !loaded?.order) return;
    await notificationsService.enqueue({
      userId: loaded.order.userId,
      type,
      referenceType: 'ReturnRequest',
      referenceId: returnId,
      templateData: {
        ...baseData(loaded),
        ...(rejectionReason ? { reason: rejectionReason } : {}),
        status,
        statusText: status === RETURN_STATUS.CLOSED ? 'closed' : status.toLowerCase(),
        ...(status === RETURN_STATUS.APPROVED ? { nextStep: 'We will arrange the pickup and email you the time slot.' } : {}),
      },
    });
  } catch (error) {
    logger.warn('Return status email failed', { returnId, status, error: error instanceof Error ? error.message : error });
  }
}

/** A return was requested: confirm to the shopper, and ask the seller to review it. */
export async function notifyReturnRequestedEvent(returnId: string): Promise<void> {
  try {
    const loaded = await load(returnId);
    if (!loaded?.order) return;
    const data = baseData(loaded);
    await notificationsService.enqueue({
      userId: loaded.order.userId,
      type: 'RETURN_REQUESTED',
      referenceType: 'ReturnRequest',
      referenceId: returnId,
      templateData: data,
    });
    const sellerId = await findVendorOwnerUserId(loaded.vendorId);
    if (sellerId) {
      await notificationsService.enqueue({
        userId: sellerId,
        type: 'VENDOR_RETURN_REQUESTED',
        referenceType: 'ReturnRequest',
        referenceId: returnId,
        templateData: data,
      });
    }
  } catch (error) {
    logger.warn('Return requested email failed', { returnId, error: error instanceof Error ? error.message : error });
  }
}

/** A seller disputes a returned item: admins have to decide. */
export async function notifyReturnEscalated(returnId: string, reason: string): Promise<void> {
  try {
    const loaded = await load(returnId);
    if (!loaded?.order) return;
    for (const adminId of await findSuperAdminUserIds()) {
      await notificationsService.enqueue({
        userId: adminId,
        type: 'ADMIN_RETURN_ESCALATION',
        referenceType: 'ReturnRequest',
        referenceId: returnId,
        templateData: { ...baseData(loaded), reason },
      });
    }
  } catch (error) {
    logger.warn('Return escalation email failed', { returnId, error: error instanceof Error ? error.message : error });
  }
}
