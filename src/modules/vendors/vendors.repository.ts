import { BaseRepository } from '@core/repository/BaseRepository';
import { Vendor } from '@database/models/vendor.model';
import { Op, WhereOptions } from 'sequelize';
import type { VendorStatus } from '@core/constants/statuses';

export class VendorsRepository extends BaseRepository<Vendor> {
  constructor() {
    super(Vendor);
  }

  async findWithFilters(filters: {
    status?: VendorStatus;
    search?: string;
    limit: number;
    offset: number;
  }) {
    const where: any = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where[Op.or] = [
        { businessName: { [Op.iLike]: `%${filters.search}%` } },
        { slug: { [Op.iLike]: `%${filters.search}%` } },
      ];
    }

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      order: [['createdAt', 'DESC']],
    });
  }

  async findBySlug(slug: string) {
    return this.model.findOne({ where: { slug } });
  }
}

export const vendorsRepository = new VendorsRepository();
