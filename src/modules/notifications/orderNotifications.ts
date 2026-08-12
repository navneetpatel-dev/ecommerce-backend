import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ROLES } from '@core/constants/statuses';
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

/**
 * Prefer an active VENDOR_STAFF user for the shop; fall back to VENDOR_OWNER, then any user on the vendor.
 */
export async function findVendorStaffUserId(
  vendorId: string | null | undefined,
): Promise<string | null> {
  if (!vendorId) return null;

  const staffRole = await Role.findOne({ where: { name: ROLES.VENDOR_STAFF } });
  if (staffRole) {
    const staff = await User.findOne({
      where: { vendorId, roleId: staffRole.id },
      attributes: ['id'],
      order: [['createdAt', 'ASC']],
    });
    if (staff?.id) return staff.id;
  }

  const ownerRole = await Role.findOne({ where: { name: ROLES.VENDOR_OWNER } });
  if (ownerRole) {
    const owner = await User.findOne({
      where: { vendorId, roleId: ownerRole.id },
      attributes: ['id'],
      order: [['createdAt', 'ASC']],
    });
    if (owner?.id) return owner.id;
  }

  return findVendorOwnerUserId(vendorId);
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
