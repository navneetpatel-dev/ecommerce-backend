import { NotFoundError } from '@core/errors/NotFoundError';
import { usersRepository } from './users.repository';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type { UpdateUserProfileRequest, UpdateUserStatusRequest, GetUsersQuery } from './users.dto';

export class UsersService {
  async getProfile(userId: string) {
    const user = await usersRepository.findById(userId, { include: ['role', 'vendor'] });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async updateProfile(userId: string, data: UpdateUserProfileRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      await usersRepository.update(userId, data, { transaction: t });
      return this.getProfile(userId);
    });
  }

  async getUsers(query: GetUsersQuery) {
    const offset = (query.page - 1) * query.limit;
    const { rows, count } = await usersRepository.findWithFilters({
      roleId: query.roleId,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    return {
      users: rows,
      pagination: {
        total: count,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  }

  async getUserById(userId: string) {
    const user = await usersRepository.findById(userId, { include: ['role', 'vendor'] });
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async updateUserStatus(userId: string, data: UpdateUserStatusRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      await usersRepository.update(userId, data, { transaction: t });
      return this.getUserById(userId);
    });
  }

  async deleteUser(userId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      // Soft delete - can be restored later
      await usersRepository.softDelete(userId, { transaction: t });
    });
  }
}

export const usersService = new UsersService();
