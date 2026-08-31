import { NotFoundError } from '@core/errors/NotFoundError';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';
import { roundMoney } from '@modules/pricing/money';
import { mapSubOrder } from '@modules/orders/orderDisplayMappers';
import { notificationsService } from '@modules/notifications/notifications.service';

function mapSubOrderRow(row: SubOrder) {
  const plain = (typeof row.get === 'function'
    ? row.get({ plain: true })
    : row) as Record<string, unknown> & {
    order?: { totalAmount?: unknown; walletAmountUsed?: unknown };
  };
  const mapped = mapSubOrder(plain);
  if (plain.order) {
    return {
      ...mapped,
      order: {
        ...plain.order,
        totalAmount: roundMoney(plain.order.totalAmount),
        walletAmountUsed: roundMoney(plain.order.walletAmountUsed),
      },
    };
  }
  return mapped;
}

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
    return rows.map(mapSubOrderRow);
  }

  async updateStatus(id: string, status: SubOrder['status'], trackingId: string | undefined, updatedBy: string) {
    const suborder = await sequelize.transaction(async (transaction) => {
      const row = await SubOrder.findByPk(id, { transaction });
      if (!row) throw new NotFoundError('SubOrder');
      await row.update({ status, trackingId: trackingId ?? row.trackingId, updatedBy }, { transaction });
      if (status === ORDER_STATUS.SHIPPED && trackingId) {
        await Shipment.findOrCreate({
          where: { subOrderId: id },
          defaults: { subOrderId: id, carrier: 'MANUAL', trackingNumber: trackingId, status: 'IN_TRANSIT', shippedAt: new Date() } as never,
          transaction,
        });
      }
      return row.reload({
        include: [
          { model: Order, as: 'order' },
          { model: OrderItem, as: 'items' },
        ],
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
      }
    }

    return mapSubOrderRow(suborder);
  }
}

export const subordersService = new SubordersService();
