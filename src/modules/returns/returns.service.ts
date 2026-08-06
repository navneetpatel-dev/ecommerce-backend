import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';

type CreateReturnInput = {
  orderItemId: string;
  reasonCode: 'DAMAGED' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'NO_LONGER_NEEDED' | 'OTHER';
  reason: string;
};

type TransitionStatus =
  | 'APPROVED'
  | 'REJECTED'
  | 'PICKUP_SCHEDULED'
  | 'RECEIVED'
  | 'REFUNDED'
  | 'CLOSED';

function serializeReturn(row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem })) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    subOrderId: plain.subOrderId,
    orderItemId: plain.orderItemId,
    userId: plain.userId,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    status: plain.status,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    resolvedAt: plain.resolvedAt,
    createdAt: plain.createdAt,
    productName: plain.orderItem?.productName ?? null,
  };
}

export class ReturnsService {
  async listForUser(userId: string) {
    const rows = await ReturnRequest.findAll({
      where: { userId },
      include: [{ model: OrderItem, as: 'orderItem', required: false }],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }));
  }

  async create(userId: string, data: CreateReturnInput) {
    return sequelize.transaction(async (t: Transaction) => {
      const orderItem = await OrderItem.findByPk(data.orderItemId, {
        include: [
          {
            model: SubOrder,
            as: 'subOrder',
            include: [{ model: Order, as: 'order' }],
          },
        ],
        transaction: t,
      });

      if (!orderItem) throw new NotFoundError('OrderItem');

      const item = orderItem as OrderItem & {
        subOrder: SubOrder & { order: Order };
      };

      if (item.subOrder.order.userId !== userId) {
        throw new ForbiddenError('Not your order');
      }
      if (item.subOrder.status !== 'DELIVERED') {
        throw new ForbiddenError('Item must be delivered before requesting a return');
      }

      const existing = await ReturnRequest.findOne({
        where: { orderItemId: data.orderItemId },
        transaction: t,
      });
      if (existing) {
        throw new ValidationError({ orderItemId: ['A return already exists for this item'] });
      }

      const created = await ReturnRequest.create(
        {
          subOrderId: item.subOrderId,
          orderItemId: data.orderItemId,
          userId,
          reason: data.reason,
          reasonCode: data.reasonCode,
          status: 'REQUESTED',
          refundAmount: null,
          resolvedById: null,
          resolvedAt: null,
          createdBy: userId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      return serializeReturn(created as ReturnRequest & { orderItem?: OrderItem });
    });
  }

  async transition(id: string, status: TransitionStatus, actorId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const row = await ReturnRequest.findByPk(id, { transaction: t });
      if (!row) throw new NotFoundError('ReturnRequest');

      await row.update(
        {
          status,
          resolvedById: ['APPROVED', 'REJECTED', 'REFUNDED', 'CLOSED'].includes(status)
            ? actorId
            : row.resolvedById,
          resolvedAt: ['REJECTED', 'REFUNDED', 'CLOSED'].includes(status)
            ? new Date()
            : row.resolvedAt,
          updatedBy: actorId,
        },
        { transaction: t },
      );

      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem });
    });
  }
}

export const returnsService = new ReturnsService();
