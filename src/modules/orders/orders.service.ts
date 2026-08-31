import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { ordersRepository } from './orders.repository';
import { sequelize } from '@database/models';
import { OrderItem } from '@database/models/orderItem.model';
import { Vendor } from '@database/models/vendor.model';
import { Shipment } from '@database/models/shipment.model';
import { mapOrderResponse } from './orderDisplayMappers';
import type { CreateOrderRequest, GetOrdersQuery } from './orders.dto';

const orderDetailInclude = [
  {
    association: 'subOrders',
    include: [
      { model: Vendor, as: 'vendor' },
      { model: OrderItem, as: 'items' },
      { model: Shipment, as: 'shipment' },
    ],
  },
  { association: 'shippingAddress' },
];

export class OrdersService {
  async createOrder(userId: string, data: CreateOrderRequest) {
    void userId;
    void data;
    throw new ValidationError('Use /api/checkout to place orders');
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
      throw new ForbiddenError('You do not have access to this order');
    }
    return mapOrderResponse(order as unknown as Record<string, unknown>);
  }

  async updateOrderStatus(id: string, status: string) {
    return sequelize.transaction(async (t) => {
      const order = await ordersRepository.findById(id, { transaction: t });
      if (!order) throw new NotFoundError('Order');

      await ordersRepository.update(id, { status: status as never }, { transaction: t });
      return this.getOrderById(id);
    });
  }
}

export const ordersService = new OrdersService();
