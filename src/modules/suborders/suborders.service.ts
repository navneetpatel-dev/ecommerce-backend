import { NotFoundError } from '@core/errors/NotFoundError';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Shipment } from '@database/models/shipment.model';
import { sequelize } from '@database/models';

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
    return sequelize.transaction(async (transaction) => {
      const suborder = await SubOrder.findByPk(id, { transaction });
      if (!suborder) throw new NotFoundError('SubOrder');
      await suborder.update({ status, trackingId: trackingId ?? suborder.trackingId, updatedBy }, { transaction });
      if (status === 'SHIPPED' && trackingId) {
        await Shipment.findOrCreate({
          where: { subOrderId: id },
          defaults: { subOrderId: id, carrier: 'MANUAL', trackingNumber: trackingId, status: 'IN_TRANSIT', shippedAt: new Date() } as any,
          transaction,
        });
      }
      return suborder.reload({ transaction });
    });
  }
}

export const subordersService = new SubordersService();
