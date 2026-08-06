import { BaseRepository } from '@core/repository/BaseRepository';
import { User } from '@database/models/user.model';
import { Op, WhereOptions } from 'sequelize';
import type { UserStatus } from '@core/constants/statuses';

export class UsersRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  async findWithFilters(filters: {
    roleId?: string;
    status?: UserStatus;
    search?: string;
    limit: number;
    offset: number;
  }) {
    const where: any = {};

    if (filters.roleId) {
      where.roleId = filters.roleId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${filters.search}%` } },
        { email: { [Op.iLike]: `%${filters.search}%` } },
      ];
    }

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      distinct: true,
      col: 'id',
      include: ['role'],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const usersRepository = new UsersRepository();
