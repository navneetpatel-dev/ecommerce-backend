import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { PAYMENT_STATUS, ROLES } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logger } from '@core/logger';
import { buildOrderEmailData } from '@modules/notifications/orderEmailData';
import { orderReference } from '@modules/orders/orderReference';

export async function findVendorOwnerUserId(vendorId: string | null | undefined): Promise<string | null> {
  if (!vendorId) return null;
  const owner = await User.findOne({
    where: { vendorId },
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  });
  return owner?.id ?? null;
}

/** Super-admin user ids for internal operational alerts. */
export async function findSuperAdminUserIds(limit = 20): Promise<string[]> {
  const adminRole = await Role.findOne({ where: { name: ROLES.SUPER_ADMIN } });
  if (!adminRole) return [];
  const admins = await User.findAll({
    where: { roleId: adminRole.id },
    attributes: ['id'],
    limit,
  });
  return admins.map((admin) => admin.id);
}

/** Fire transactional emails after an order is paid / COD-confirmed. */
export async function notifyOrderConfirmed(orderId: string): Promise<void> {
  try {
    const order = await Order.findByPk(orderId, {
      include: [{ model: SubOrder, as: 'subOrders' }],
    });
    if (!order) return;

    const orderNumber = orderReference(order.id);
    const total = Number(order.totalAmount ?? 0);

    const rich = await buildOrderEmailData(order.id, { withTotals: true, withAddress: true, withPayment: true });
    await notificationsService.sendOrderConfirmation(order.userId, order.id, {
      orderId: order.id,
      orderNumber,
      total,
      ...rich,
    });
    // A receipt says money was received, so only for orders that are paid (online
    // or wallet). Cash on delivery has taken nothing yet.
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      await notificationsService.sendPaymentReceipt(order.userId, order.id, {
        orderId: order.id,
        orderNumber,
        total,
        ...rich,
        items: [],
        detailsTitle: 'Payment details',
      });
    }

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
        ...(await buildOrderEmailData(order.id, { subOrderId: sub.id })),
      });
    }
  } catch (error) {
    logger.warn('notifyOrderConfirmed failed', {
      orderId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
