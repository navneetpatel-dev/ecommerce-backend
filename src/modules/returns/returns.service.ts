import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { COMMISSION_STATUS, DOCUMENT_SEQUENCE_KIND, ORDER_STATUS, RETURN_STATUS, type ReturnReason, type ReturnStatus } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { pricingService } from '@modules/pricing/pricing.service';
import { nextDocumentNumber } from '@modules/pricing/documentSequence';
import { notificationsService } from '@modules/notifications/notifications.service';

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
    orderItemId: plain.orderItemId,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    status: plain.status,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    refundTaxAmount: plain.refundTaxAmount != null ? Number(plain.refundTaxAmount) : null,
    refundCommissionAmount:
      plain.refundCommissionAmount != null ? Number(plain.refundCommissionAmount) : null,
    refundTcsAmount: plain.refundTcsAmount != null ? Number(plain.refundTcsAmount) : null,
    refundNetClawback: plain.refundNetClawback != null ? Number(plain.refundNetClawback) : null,
    resolvedAt: plain.resolvedAt,
    createdAt: plain.createdAt,
    productName: plain.orderItem?.productName ?? null,
    customerName: plain.user?.name ?? null,
  };
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
    const result = await sequelize.transaction(async (t: Transaction) => {
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

      if (
        (status === RETURN_STATUS.APPROVED || status === RETURN_STATUS.REFUNDED) &&
        row.refundAmount == null
      ) {
        const orderItem = (row as any).orderItem as OrderItem & {
          subOrder: SubOrder & { items?: OrderItem[]; orderId: string };
        };
        if (orderItem?.subOrder) {
          const frozen = pricingService.frozenLineFromOrderItem({
            id: orderItem.id,
            quantity: Number(orderItem.quantity),
            unitPrice: Number(orderItem.unitPrice),
            discountAmount: Number(orderItem.discountAmount ?? 0),
            taxableAmount: Number(orderItem.taxableAmount ?? 0),
            taxAmount: Number(orderItem.taxAmount ?? 0),
            taxBreakdown: (orderItem.taxBreakdown as any) ?? null,
            commissionAmount: Number(orderItem.commissionAmount ?? 0),
            tcsAmount: Number(orderItem.tcsAmount ?? 0),
            netPayoutAmount: Number(orderItem.netPayoutAmount ?? 0),
            unitPricePaise: Number(orderItem.unitPricePaise ?? 0),
            discountAmountPaise: Number(orderItem.discountAmountPaise ?? 0),
            taxableAmountPaise: Number(orderItem.taxableAmountPaise ?? 0),
            taxAmountPaise: Number(orderItem.taxAmountPaise ?? 0),
            commissionAmountPaise: Number(orderItem.commissionAmountPaise ?? 0),
            tcsAmountPaise: Number(orderItem.tcsAmountPaise ?? 0),
            netPayoutAmountPaise: Number(orderItem.netPayoutAmountPaise ?? 0),
          });
          const reversal = pricingService.reverseLineFromFrozen(
            frozen,
            Number(orderItem.quantity),
          );
          patch.refundAmount = fromPaise(reversal.customerRefundPaise);
          patch.refundTaxAmount = fromPaise(reversal.refundTaxPaise);
          patch.refundCommissionAmount = fromPaise(reversal.refundCommissionPaise);
          patch.refundTcsAmount = fromPaise(reversal.refundTcsPaise);
          patch.refundNetClawback = fromPaise(reversal.refundNetClawbackPaise);

          const existingCredit = await CreditNote.findOne({
            where: { returnRequestId: row.id },
            transaction: t,
          });
          if (!existingCredit) {
            const cnNumber = await nextDocumentNumber(DOCUMENT_SEQUENCE_KIND.CREDIT_NOTE, t);
            await CreditNote.create(
              {
                number: cnNumber,
                returnRequestId: row.id,
                orderId: orderItem.subOrder.orderId,
                orderItemId: orderItem.id,
                userId: row.userId,
                merchandisePaise: reversal.refundMerchandisePaise,
                taxPaise: reversal.refundTaxPaise,
                totalPaise: reversal.customerRefundPaise,
                taxBreakdown: {
                  refundTaxPaise: reversal.refundTaxPaise,
                },
                createdBy: actorId,
                updatedBy: actorId,
                deletedBy: null,
              },
              { transaction: t },
            );
          }

          const vendorId = orderItem.subOrder.vendorId;
          if (vendorId) {
            const existingDebit = await DebitNote.findOne({
              where: { returnRequestId: row.id },
              transaction: t,
            });
            if (!existingDebit) {
              const dnNumber = await nextDocumentNumber(DOCUMENT_SEQUENCE_KIND.DEBIT_NOTE, t);
              await DebitNote.create(
                {
                  number: dnNumber,
                  returnRequestId: row.id,
                  orderId: orderItem.subOrder.orderId,
                  orderItemId: orderItem.id,
                  vendorId,
                  commissionPaise: reversal.refundCommissionPaise,
                  tcsPaise: reversal.refundTcsPaise,
                  netClawbackPaise: reversal.refundNetClawbackPaise,
                  createdBy: actorId,
                  updatedBy: actorId,
                  deletedBy: null,
                },
                { transaction: t },
              );
            }
          }

          const sub = orderItem.subOrder;
          const nextSubtotalPaise = Math.max(
            0,
            Number(sub.subtotalPaise ?? 0) - reversal.refundSubtotalPaise,
          );
          const nextDiscountPaise = Math.max(
            0,
            Number(sub.discountAmountPaise ?? 0) - reversal.refundDiscountPaise,
          );
          const nextTaxablePaise = Math.max(
            0,
            Number(sub.taxableAmountPaise ?? 0) - reversal.refundMerchandisePaise,
          );
          const nextTaxPaise = Math.max(
            0,
            Number(sub.taxAmountPaise ?? 0) - reversal.refundTaxPaise,
          );
          const nextCommissionPaise = Math.max(
            0,
            Number(sub.commissionAmountPaise ?? 0) - reversal.refundCommissionPaise,
          );
          const nextTcsPaise = Math.max(
            0,
            Number(sub.tcsAmountPaise ?? 0) - reversal.refundTcsPaise,
          );
          const nextNetPaise = Math.max(
            0,
            Number(sub.netPayoutAmountPaise ?? 0) - reversal.refundNetClawbackPaise,
          );
          await sub.update(
            {
              subtotal: fromPaise(nextSubtotalPaise),
              discountAmount: fromPaise(nextDiscountPaise),
              taxableAmount: fromPaise(nextTaxablePaise),
              taxAmount: fromPaise(nextTaxPaise),
              commissionAmount: fromPaise(nextCommissionPaise),
              tcsAmount: fromPaise(nextTcsPaise),
              netPayoutAmount: fromPaise(nextNetPaise),
              subtotalPaise: nextSubtotalPaise,
              discountAmountPaise: nextDiscountPaise,
              taxableAmountPaise: nextTaxablePaise,
              taxAmountPaise: nextTaxPaise,
              commissionAmountPaise: nextCommissionPaise,
              tcsAmountPaise: nextTcsPaise,
              netPayoutAmountPaise: nextNetPaise,
              updatedBy: actorId,
            },
            { transaction: t },
          );

          const order = await Order.findByPk(sub.orderId, { transaction: t });
          if (order) {
            const nextOrderTotalPaise = Math.max(
              0,
              toPaise(Number(order.totalAmount)) - reversal.customerRefundPaise,
            );
            const nextDiscountTotal = Math.max(
              0,
              Number(order.discountTotal ?? 0) - fromPaise(reversal.refundDiscountPaise),
            );
            await order.update(
              {
                totalAmount: fromPaise(nextOrderTotalPaise),
                discountTotal: nextDiscountTotal,
                updatedBy: actorId,
              },
              { transaction: t },
            );
          }

          await orderItem.update(
            {
              discountAmount: 0,
              taxableAmount: 0,
              taxAmount: 0,
              commissionAmount: 0,
              tcsAmount: 0,
              netPayoutAmount: 0,
              discountAmountPaise: 0,
              taxableAmountPaise: 0,
              taxAmountPaise: 0,
              commissionAmountPaise: 0,
              tcsAmountPaise: 0,
              netPayoutAmountPaise: 0,
              updatedBy: actorId,
            },
            { transaction: t },
          );

          const ledger = await CommissionLedger.findOne({
            where: { subOrderId: orderItem.subOrderId },
            transaction: t,
          });
          if (ledger) {
            const nextSale = Math.max(
              0,
              Number(ledger.saleAmount) - fromPaise(reversal.refundMerchandisePaise),
            );
            const nextCommission = Math.max(
              0,
              Number(ledger.commissionAmount) - fromPaise(reversal.refundCommissionPaise),
            );
            const nextTaxable = Math.max(
              0,
              Number(ledger.taxableAmount ?? 0) - fromPaise(reversal.refundMerchandisePaise),
            );
            const nextTcs = Math.max(
              0,
              Number(ledger.tcsAmount ?? 0) - fromPaise(reversal.refundTcsPaise),
            );
            const nextNet = Math.max(
              0,
              Number(ledger.netPayoutAmount ?? 0) - fromPaise(reversal.refundNetClawbackPaise),
            );
            const nextTax = Math.max(
              0,
              Number(ledger.taxAmount ?? 0) - fromPaise(reversal.refundTaxPaise),
            );
            const salePaise = Math.max(
              0,
              Number(ledger.saleAmountPaise ?? 0) - reversal.refundMerchandisePaise,
            );
            const commissionPaise = Math.max(
              0,
              Number(ledger.commissionAmountPaise ?? 0) - reversal.refundCommissionPaise,
            );
            const taxablePaise = Math.max(
              0,
              Number(ledger.taxableAmountPaise ?? 0) - reversal.refundMerchandisePaise,
            );
            const tcsPaise = Math.max(
              0,
              Number(ledger.tcsAmountPaise ?? 0) - reversal.refundTcsPaise,
            );
            const netPaise = Math.max(
              0,
              Number(ledger.netPayoutAmountPaise ?? 0) - reversal.refundNetClawbackPaise,
            );
            const taxPaise = Math.max(
              0,
              Number(ledger.taxAmountPaise ?? 0) - reversal.refundTaxPaise,
            );
            const discountPaise = Math.max(
              0,
              Number(ledger.discountAmountPaise ?? 0) - reversal.refundDiscountPaise,
            );
            await ledger.update(
              {
                saleAmount: nextSale,
                commissionAmount: nextCommission,
                taxableAmount: nextTaxable,
                tcsAmount: nextTcs,
                taxAmount: nextTax,
                netPayoutAmount: nextNet,
                discountAmount: fromPaise(discountPaise),
                saleAmountPaise: salePaise,
                commissionAmountPaise: commissionPaise,
                taxableAmountPaise: taxablePaise,
                tcsAmountPaise: tcsPaise,
                taxAmountPaise: taxPaise,
                netPayoutAmountPaise: netPaise,
                discountAmountPaise: discountPaise,
                status: nextNet <= 0 ? COMMISSION_STATUS.CLAWED_BACK : ledger.status,
                updatedBy: actorId,
              },
              { transaction: t },
            );
          }
        }
      } else if (status === RETURN_STATUS.APPROVED || status === RETURN_STATUS.REFUNDED) {
        // Financial reversal already frozen on this return — keep existing refund snapshot.
      }

      await row.update(patch, { transaction: t });

      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem });
    });

    const orderItem = await OrderItem.findByPk(result.orderItemId, {
      include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
    });
    const order = (orderItem as any)?.subOrder?.order as Order | undefined;
    if (order?.userId) {
      const orderNumber = order.id.slice(0, 8).toUpperCase();
      if (status === RETURN_STATUS.APPROVED || status === RETURN_STATUS.CLOSED) {
        void notificationsService.sendOrderReturned(order.userId, result.id, {
          orderId: order.id,
          orderNumber,
          status,
        });
      }
      if (status === RETURN_STATUS.REFUNDED) {
        void notificationsService.sendRefundProcessed(order.userId, result.id, {
          orderId: order.id,
          orderNumber,
          amount: result.refundAmount ?? 0,
        });
      }
    }

    return result;
  }
}

export const returnsService = new ReturnsService();
