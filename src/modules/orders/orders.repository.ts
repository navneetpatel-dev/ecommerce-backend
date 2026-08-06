import { BaseRepository } from '@core/repository/BaseRepository';
import { Order } from '@database/models/order.model';
import { WhereOptions } from 'sequelize';

export class OrdersRepository extends BaseRepository<Order> {
  constructor() {
    super(Order);
  }

  async findWithFilters(filters: {
    userId?: string;
    status?: string;
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

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      include: [
        {
          association: 'subOrders',
          include: ['items', 'vendor'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const ordersRepository = new OrdersRepository();
