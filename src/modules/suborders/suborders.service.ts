import { NotFoundError } from '@core/errors/NotFoundError';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';
import { notificationsService } from '@modules/notifications/notifications.service';

export class SubordersService {
  async list(vendorId?: string | null) {
    const rows = await SubOrder.findAll({
      where: vendorId ? { vendorId } : undefined,
      include: [
        { model: OrderItem, as: 'items' },
        { model: Order, as: 'order' },
        { model: Vendor, as: 'vendor' },
      ],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row: any) => ({ ...row.get({ plain: true }), subtotal: Number(row.subtotal), commissionAmount: Number(row.commissionAmount ?? 0) }));
  }

  async updateStatus(id: string, status: SubOrder['status'], trackingId: string | undefined, updatedBy: string) {
    const suborder = await sequelize.transaction(async (transaction) => {
      const row = await SubOrder.findByPk(id, { transaction });
      if (!row) throw new NotFoundError('SubOrder');
      await row.update({ status, trackingId: trackingId ?? row.trackingId, updatedBy }, { transaction });
      if (status === ORDER_STATUS.SHIPPED && trackingId) {
        await Shipment.findOrCreate({
          where: { subOrderId: id },
          defaults: { subOrderId: id, carrier: 'MANUAL', trackingNumber: trackingId, status: 'IN_TRANSIT', shippedAt: new Date() } as any,
          transaction,
        });
      }
      return row.reload({
        include: [{ model: Order, as: 'order' }],
        transaction,
      });
    });

    const order = (suborder as SubOrder & { order?: Order }).order;
    if (order?.userId) {
      const orderNumber = order.id.slice(0, 8).toUpperCase();
      if (status === ORDER_STATUS.SHIPPED) {
        void notificationsService.sendSubOrderShipped(order.userId, suborder.id, {
          orderId: order.id,
          orderNumber,
          trackingId: suborder.trackingId,
        });
      }
      if (status === ORDER_STATUS.DELIVERED) {
        void notificationsService.sendSubOrderDelivered(order.userId, suborder.id, {
          orderId: order.id,
          orderNumber,
        });
        void import('@modules/wallet/cashback.service').then(({ creditPendingCashbackForOrder }) =>
          creditPendingCashbackForOrder(order.id),
        );
      }
    }

    return suborder;
  }
}

export const subordersService = new SubordersService();
