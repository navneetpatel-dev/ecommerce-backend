import { BaseRepository } from '@core/repository/BaseRepository';
import { Order } from '@database/models/order.model';
import { Op, type WhereOptions } from 'sequelize';
import { sequelize } from '@database/models';

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
        sequelize.literal(
          `("Order"."id"::text ILIKE ${sequelize.escape(q)} OR "user"."name" ILIKE ${sequelize.escape(q)} OR "user"."email" ILIKE ${sequelize.escape(q)})`,
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
          include: ['items', 'vendor', 'shipment'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const ordersRepository = new OrdersRepository();
