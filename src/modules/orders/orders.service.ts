import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { ordersRepository } from './orders.repository';
import { sequelize } from '@database/models';
import { OrderItem } from '@database/models/orderItem.model';
import { Vendor } from '@database/models/vendor.model';
import { Shipment } from '@database/models/shipment.model';
import { ShipmentAttempt } from '@database/models/shipmentAttempt.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { mapOrderResponse } from './orderDisplayMappers';
import { cancelPaidOrder } from './ordersCancel.service';
import type { CreateOrderRequest, GetOrdersQuery } from './orders.dto';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { Op } from 'sequelize';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ORDER_STATUS, REFUND_STATUS, RETURN_STATUS } from '@core/constants/statuses';

/**
 * Transitions reachable through this manual, admin-facing endpoint.
 * DELIVERED is deliberately absent — it's only reachable through the
 * cascade in `shippingService`'s `cascadeOrderDeliveredAndNotify`, once
 * every sibling suborder has genuinely settled (OTP-confirmed delivery,
 * cancellation, or return). CANCELLED is likewise absent — cancelling an
 * order has its own dedicated flow (`POST /:id/cancel` -> `cancelPaidOrder`)
 * that restores stock, destroys coupon usage, and processes refunds; a raw
 * status PATCH to CANCELLED would silently skip all of that. RETURNED is
 * owned by the returns module via `ReturnRequest.status`.
 */
const ORDER_MANUAL_TRANSITIONS: Record<string, readonly string[]> = {
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.SHIPPED],
};

function assertOrderTransition(from: string, to: string) {
  if (from === to) return;
  if (!ORDER_MANUAL_TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError({ status: [`Cannot move an order from ${from} to ${to} here`] });
  }
}

const orderDetailInclude = [
  {
    association: 'subOrders',
    include: [
      { model: Vendor, as: 'vendor' },
      {
        model: OrderItem,
        as: 'items',
        // Product name/price are frozen on the line; the image is looked up live
        // so order views can show a thumbnail without storing a stale URL.
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            required: false,
            include: [
              {
                model: Product,
                as: 'product',
                required: false,
                include: ['images'],
              },
            ],
          },
        ],
      },
      {
        model: Shipment,
        as: 'shipment',
        include: [
          {
            model: DeliveryAgent,
            as: 'deliveryAgent',
            attributes: ['id', 'fullName', 'phone'],
          },
          {
            model: ShipmentAttempt,
            as: 'attempts',
            separate: true,
            order: [['attemptNumber', 'ASC']] as [string, string][],
          },
        ],
      },
    ],
  },
  { association: 'shippingAddress' },
];

export class OrdersService {
  async createOrder(userId: string, data: CreateOrderRequest) {
    void userId;
    void data;
    throw new ValidationError(ERROR_MESSAGES.ORDER_USE_CHECKOUT);
  }

  async getOrders(userId: string | null, query: GetOrdersQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await ordersRepository.findWithFilters({
      userId: userId ?? undefined,
      status: query.status,
      limit: query.limit,
      offset,
    });

    return {
      orders: rows.map((row) => mapOrderResponse(row as unknown as Record<string, unknown>)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /**
   * Order history is intentionally UNSCOPED.
   * OrderItem.productName / unitPrice are frozen snapshots from checkout — later
   * vendor suspension or product unpublish must not hide or rewrite past purchases.
   */
  async getOrderById(id: string, userId?: string) {
    const order = await ordersRepository.findById(id, {
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundError('Order');
    if (userId && order.userId !== userId) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_ORDER);
    }
    const mapped = mapOrderResponse(order as unknown as Record<string, unknown>);
    return {
      ...mapped,
      ...(await this.orderReturnSummary(mapped.subOrders as unknown as Array<{ id: string }>)),
    };
  }

  async cancelPaidOrder(orderId: string, userId: string, isAdmin: boolean) {
    return cancelPaidOrder(orderId, userId, isAdmin);
  }

  private async orderReturnSummary(subOrders: Array<{ id: string }>) {
    const subOrderIds = subOrders.map((sub) => sub.id).filter(Boolean);
    if (subOrderIds.length === 0) {
      return { openReturnCount: 0, returnRefundAlerts: [] as Array<{ id: string; refundStatus: string }> };
    }
    const rows = await ReturnRequest.findAll({
      where: { subOrderId: { [Op.in]: subOrderIds } },
      attributes: ['id', 'status', 'refundStatus'],
    });
    const openStatuses = new Set<string>([
      RETURN_STATUS.REQUESTED,
      RETURN_STATUS.APPROVED,
      RETURN_STATUS.PICKUP_SCHEDULED,
      RETURN_STATUS.RECEIVED,
    ]);
    const openReturnCount = rows.filter((row) => openStatuses.has(row.status)).length;
    const returnRefundAlerts = rows
      .filter((row) => row.refundStatus === REFUND_STATUS.INITIATED || row.refundStatus === REFUND_STATUS.FAILED)
      .map((row) => ({ id: row.id, refundStatus: String(row.refundStatus) }));
    return { openReturnCount, returnRefundAlerts };
  }

  async updateOrderStatus(id: string, status: string) {
    return sequelize.transaction(async (t) => {
      const order = await ordersRepository.findById(id, { transaction: t });
      if (!order) throw new NotFoundError('Order');

      assertOrderTransition(order.status, status);
      await ordersRepository.update(id, { status: status as never }, { transaction: t });
      return this.getOrderById(id);
    });
  }
}

export const ordersService = new OrdersService();
