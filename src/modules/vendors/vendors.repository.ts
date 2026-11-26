import { escapeLikePattern } from '@modules/search/search.utils';
import { BaseRepository } from '@core/repository/BaseRepository';
import { Vendor } from '@database/models/vendor.model';
import { Op } from 'sequelize';
import type { VendorStatus } from '@core/constants/statuses';

export class VendorsRepository extends BaseRepository<Vendor> {
  constructor() {
    super(Vendor);
  }

  async findWithFilters(filters: {
    status?: VendorStatus;
    /** Only vendors whose KYC documents are all verified (those that can sell). */
    kycVerified?: boolean;
    search?: string;
    /** Exactly this vendor. */
    id?: string;
    /** Picker mode: only id and name, sorted by name (stable with the id), so pages never repeat. */
    light?: boolean;
    limit: number;
    offset: number;
  }) {
    const where: any = {};

    if (filters.id) {
      where.id = filters.id;
    }

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.kycVerified !== undefined) {
      where.kycVerified = filters.kycVerified;
    }

    // Wildcards typed by the user are literal characters, not patterns.
    const like = filters.search ? escapeLikePattern(filters.search) : '';
    if (filters.search) {
      where[Op.or] = [
        { businessName: { [Op.iLike]: `%${like}%` } },
        { slug: { [Op.iLike]: `%${like}%` } },
      ];
    }

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      ...(filters.light ? { attributes: ['id', 'businessName'] } : {}),
      order: filters.light ? [['businessName', 'ASC'], ['id', 'ASC']] : [['createdAt', 'DESC'], ['id', 'ASC']],
    });
  }

  async findBySlug(slug: string) {
    return this.model.findOne({ where: { slug } });
  }
}

export const vendorsRepository = new VendorsRepository();
