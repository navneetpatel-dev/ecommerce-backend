import { BaseRepository } from '@core/repository/BaseRepository';
import { Address } from '@database/models/address.model';
import type { RepositoryOptions } from '@core/repository/BaseRepository';

export class AddressesRepository extends BaseRepository<Address> {
  constructor() {
    super(Address);
  }

  findByUserId(userId: string, options?: RepositoryOptions) {
    return this.model.findAll({
      where: { userId },
      order: [
        ['isDefault', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      transaction: options?.transaction,
    });
  }

  clearDefaultsForUser(userId: string, options?: RepositoryOptions) {
    return this.model.update(
      { isDefault: false },
      {
        where: { userId, isDefault: true },
        transaction: options?.transaction,
      },
    );
  }
}

export const addressesRepository = new AddressesRepository();
