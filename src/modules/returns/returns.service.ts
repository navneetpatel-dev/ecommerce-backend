import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  COMMISSION_STATUS,
  ORDER_STATUS,
  RETURN_STATUS,
  type ReturnReason,
  type ReturnStatus,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { roundMoney } from '@modules/coupons/coupon.utils';

const returnListInclude = [
  { model: OrderItem, as: 'orderItem', required: false, attributes: ['id', 'productName'] },
  { model: User, as: 'user', required: false, attributes: ['id', 'name'] },
];

type CreateReturnInput = {
  orderItemId: string;
  reasonCode: ReturnReason;
  reason: string;
};

const RESOLVED_BY_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];
const RESOLVED_AT_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];

function serializeReturn(row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem })) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    status: plain.status,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    resolvedAt: plain.resolvedAt,
    createdAt: plain.createdAt,
    productName: plain.orderItem?.productName ?? null,
    customerName: plain.user?.name ?? null,
  };
}

/** Line share of (unitPrice*qty - prorated suborder discount). */
function computeLineRefundAmount(
  item: OrderItem,
  subOrder: SubOrder,
  siblingItems: OrderItem[],
): number {
  const lineGross = Number(item.unitPrice) * Number(item.quantity);
  const subtotal = siblingItems.reduce(
    (sum, row) => sum + Number(row.unitPrice) * Number(row.quantity),
    0,
  );
  const discountAmount = Number(subOrder.discountAmount ?? 0);
  const lineDiscount =
    subtotal > 0 ? roundMoney((discountAmount * lineGross) / subtotal) : 0;
  return roundMoney(Math.max(0, lineGross - lineDiscount));
}

export class ReturnsService {
  async listForUser(userId: string) {
    const rows = await ReturnRequest.findAll({
      where: { userId },
      include: returnListInclude,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }));
  }

  async listAll(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await ReturnRequest.findAndCountAll({
      include: returnListInclude,
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      returns: rows.map((row) => serializeReturn(row as ReturnRequest & { orderItem?: OrderItem })),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
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
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
      }
      if (item.subOrder.status !== ORDER_STATUS.DELIVERED) {
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
          status: RETURN_STATUS.REQUESTED,
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

  async transition(id: string, status: ReturnStatus, actorId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const row = await ReturnRequest.findByPk(id, {
        include: [
          {
            model: OrderItem,
            as: 'orderItem',
            include: [
              {
                model: SubOrder,
                as: 'subOrder',
                include: [{ model: OrderItem, as: 'items' }],
              },
            ],
          },
        ],
        transaction: t,
      });
      if (!row) throw new NotFoundError('ReturnRequest');

      const patch: Record<string, unknown> = {
        status,
        resolvedById: RESOLVED_BY_STATUSES.includes(status) ? actorId : row.resolvedById,
        resolvedAt: RESOLVED_AT_STATUSES.includes(status) ? new Date() : row.resolvedAt,
        updatedBy: actorId,
      };

      if (status === RETURN_STATUS.APPROVED || status === RETURN_STATUS.REFUNDED) {
        const orderItem = (row as any).orderItem as OrderItem & {
          subOrder: SubOrder & { items?: OrderItem[] };
        };
        if (orderItem?.subOrder) {
          const siblings =
            orderItem.subOrder.items ??
            (await OrderItem.findAll({ where: { subOrderId: orderItem.subOrderId }, transaction: t }));
          const refundAmount = computeLineRefundAmount(orderItem, orderItem.subOrder, siblings);
          patch.refundAmount = refundAmount;

          const ledger = await CommissionLedger.findOne({
            where: { subOrderId: orderItem.subOrderId },
            transaction: t,
          });
          if (ledger && Number(ledger.saleAmount) > 0) {
            const subtotal = Number(orderItem.subOrder.subtotal);
            const lineGross = Number(orderItem.unitPrice) * Number(orderItem.quantity);
            const saleShare =
              subtotal > 0 ? roundMoney((Number(ledger.saleAmount) * lineGross) / subtotal) : 0;
            const commissionShare =
              subtotal > 0
                ? roundMoney((Number(ledger.commissionAmount) * lineGross) / subtotal)
                : 0;
            const nextSale = roundMoney(Math.max(0, Number(ledger.saleAmount) - saleShare));
            const nextCommission = roundMoney(
              Math.max(0, Number(ledger.commissionAmount) - commissionShare),
            );
            await ledger.update(
              {
                saleAmount: nextSale,
                commissionAmount: nextCommission,
                status: nextSale <= 0 ? COMMISSION_STATUS.CLAWED_BACK : ledger.status,
                updatedBy: actorId,
              },
              { transaction: t },
            );
          }
        }
      }

      await row.update(patch, { transaction: t });

      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem });
    });
  }
}

export const returnsService = new ReturnsService();
