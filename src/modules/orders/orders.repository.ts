import { BaseRepository } from '@core/repository/BaseRepository';
import { Order } from '@database/models/order.model';
import { Op, type WhereOptions } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_VENDOR_ATTRIBUTES } from './orderPublicAttributes';

export class OrdersRepository extends BaseRepository<Order> {
  constructor() {
    super(Order);
  }

  async findWithFilters(filters: {
    userId?: string;
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    const where: WhereOptions<Order> = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.status) {
      where.status = filters.status as any;
    }

    if (filters.search?.trim()) {
      const q = `%${filters.search.trim()}%`;
      (where as any)[Op.and] = [
        // EXISTS on users, not the "user" join: with a limit and the sub-orders
        // include, Order is read in a subquery that does not have that join.
        sequelize.literal(
          `("Order"."id"::text ILIKE ${sequelize.escape(q)} OR EXISTS (SELECT 1 FROM users u WHERE u.id = "Order"."userId" AND (u.name ILIKE ${sequelize.escape(q)} OR u.email ILIKE ${sequelize.escape(q)})))`,
        ),
      ];
    }

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      distinct: true,
      col: 'id',
      include: [
        {
          association: 'user',
          attributes: ['id', 'name', 'email'],
        },
        {
          association: 'subOrders',
          include: ['items', { association: 'vendor', attributes: ORDER_VENDOR_ATTRIBUTES }, 'shipment'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const ordersRepository = new OrdersRepository();
