import { User } from '@database/models/user.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logger } from '@core/logger';

export async function findVendorOwnerUserId(vendorId: string | null | undefined): Promise<string | null> {
  if (!vendorId) return null;
  const owner = await User.findOne({
    where: { vendorId },
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  });
  return owner?.id ?? null;
}

/** Fire transactional emails after an order is paid / COD-confirmed. */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const order = await Order.findByPk(orderId, {
      include: [{ model: SubOrder, as: 'subOrders' }],
    });
    if (!order) return;

    const orderNumber = order.id.slice(0, 8).toUpperCase();
    const total = Number(order.totalAmount ?? 0);

    await notificationsService.sendOrderConfirmation(order.userId, order.id, {
      orderId: order.id,
      orderNumber,
      total,
    });
    await notificationsService.sendPaymentReceipt(order.userId, order.id, {
      orderId: order.id,
      orderNumber,
      total,
    });

    const subOrders =
      ((order as Order & { subOrders?: SubOrder[] }).subOrders ??
        (await SubOrder.findAll({ where: { orderId: order.id } }))) as SubOrder[];

    for (const sub of subOrders) {
      const vendorUserId = await findVendorOwnerUserId(sub.vendorId);
      if (!vendorUserId) continue;
      await notificationsService.sendVendorNewOrder(vendorUserId, sub.id, {
        orderId: order.id,
        orderNumber,
        subtotal: Number(sub.subtotal ?? 0),
      });
    }
  } catch (error) {
    logger.warn('notifyOrderConfirmed failed', {
      orderId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
