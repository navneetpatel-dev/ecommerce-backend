import { NotFoundError } from '@core/errors/NotFoundError';
import { usersRepository } from './users.repository';
import { addressesRepository } from './addresses.repository';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type {
  UpdateUserProfileRequest,
  UpdateUserStatusRequest,
  GetUsersQuery,
  CreateAddressRequest,
} from './users.dto';

function serializeAddress(address: {
  id: string;
  userId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
  isDefault: boolean;
}) {
  return {
    id: address.id,
    userId: address.userId,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    country: address.country,
    pincode: address.pincode,
    isDefault: Boolean(address.isDefault),
  };
}

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

  async listAddresses(userId: string) {
    const addresses = await addressesRepository.findByUserId(userId);
    return addresses.map(serializeAddress);
  }

  async createAddress(userId: string, data: CreateAddressRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const existing = await addressesRepository.findByUserId(userId);
      const makeDefault = Boolean(data.isDefault) || existing.length === 0;

      if (makeDefault) {
        await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      }

      const address = await addressesRepository.create(
        {
          userId,
          line1: data.line1,
          line2: data.line2 ?? null,
          city: data.city,
          state: data.state,
          country: data.country || 'India',
          pincode: data.pincode,
          isDefault: makeDefault,
        } as any,
        { transaction: t },
      );

      return serializeAddress(address);
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

      await usersRepository.softDelete(userId, { transaction: t });
    });
  }
}

export const usersService = new UsersService();
