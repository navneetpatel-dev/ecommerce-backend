import { BaseRepository } from '@core/repository/BaseRepository';
import { Address } from '@database/models/address.model';
import type { RepositoryOptions } from '@core/repository/BaseRepository';

export class AddressesRepository extends BaseRepository<Address> {
  constructor() {
    super(Address);
  }

  findByUserId(userId: string) {
    return this.model.findAll({
      where: { userId } as any,
      order: [
        ['isDefault', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
  }

  clearDefaultsForUser(userId: string, options?: RepositoryOptions) {
    return this.model.update(
      { isDefault: false } as any,
      {
        where: { userId, isDefault: true } as any,
        transaction: options?.transaction,
      },
    );
  }
}

export const addressesRepository = new AddressesRepository();
