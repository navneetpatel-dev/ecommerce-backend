import { NotFoundError } from '@core/errors/NotFoundError';
import { ordersRepository } from './orders.repository';
import { sequelize } from '@database/models';
import type { CreateOrderRequest, GetOrdersQuery } from './orders.dto';

export class OrdersService {
  async createOrder(userId: string, data: CreateOrderRequest) {
    return sequelize.transaction(async (t) => {
      // TODO: Implement full order creation with cart splitting logic
      const order = await ordersRepository.create({
        userId,
        shippingAddressId: data.shippingAddressId,
        couponId: data.couponId ?? null,
        totalAmount: 0,
        discountTotal: 0,
        status: 'PENDING',
        paymentStatus: 'PENDING',
      }, { transaction: t });

      return order;
    });
  }

  async getOrders(userId: string | null, query: GetOrdersQuery) {
    const offset = (query.page - 1) * query.limit;
    const { rows, count } = await ordersRepository.findWithFilters({
      userId: userId ?? undefined,
      status: query.status,
      limit: query.limit,
      offset,
    });

    return {
      orders: rows,
      pagination: {
        total: count,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  }

  async getOrderById(id: string) {
    const order = await ordersRepository.findById(id, {
      include: ['subOrders', 'user', 'shippingAddress'],
    });
    if (!order) throw new NotFoundError('Order');
    return order;
  }

  async updateOrderStatus(id: string, status: string) {
    return sequelize.transaction(async (t) => {
      const order = await ordersRepository.findById(id, { transaction: t });
      if (!order) throw new NotFoundError('Order');

      await ordersRepository.update(id, { status: status as any }, { transaction: t });
      return this.getOrderById(id);
    });
  }
}

export const ordersService = new OrdersService();
