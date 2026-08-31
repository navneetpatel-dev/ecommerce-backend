import { NotFoundError } from '@core/errors/NotFoundError';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';
import { coerceRupees, roundMoney } from '@modules/pricing/money';
import { notificationsService } from '@modules/notifications/notifications.service';

function mapOrderItem(item: any) {
  const plain = typeof item.get === 'function' ? item.get({ plain: true }) : item;
  return {
    ...plain,
    quantity: Math.trunc(coerceRupees(plain.quantity)) || 0,
    unitPrice: roundMoney(plain.unitPrice),
    discountAmount: roundMoney(plain.discountAmount),
    taxableAmount: roundMoney(plain.taxableAmount),
    taxAmount: roundMoney(plain.taxAmount),
    commissionAmount: roundMoney(plain.commissionAmount),
    tcsAmount: roundMoney(plain.tcsAmount),
    netPayoutAmount: roundMoney(plain.netPayoutAmount),
  };
}

function mapSubOrder(row: any) {
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  return {
    ...plain,
    subtotal: roundMoney(plain.subtotal),
    shippingCost: roundMoney(plain.shippingCost),
    shippingDiscountAmount: roundMoney(plain.shippingDiscountAmount),
    taxAmount: roundMoney(plain.taxAmount),
    taxableAmount: roundMoney(plain.taxableAmount),
    discountAmount: roundMoney(plain.discountAmount),
    commissionAmount: roundMoney(plain.commissionAmount),
    tcsAmount: roundMoney(plain.tcsAmount),
    netPayoutAmount: roundMoney(plain.netPayoutAmount),
    items: (plain.items ?? []).map(mapOrderItem),
    order: plain.order
      ? {
          ...plain.order,
          totalAmount: roundMoney(plain.order.totalAmount),
          walletAmountUsed: roundMoney(plain.order.walletAmountUsed),
        }
      : plain.order,
  };
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
    return rows.map(mapSubOrder);
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
        // Cashback credit is handled by the delayed scheduler (same pattern as REVIEW_REQUEST).
      }
    }

    return mapSubOrder(suborder);
  }
}

export const subordersService = new SubordersService();
