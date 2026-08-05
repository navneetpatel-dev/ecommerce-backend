import { BaseRepository } from '@core/repository/BaseRepository';
import { Product } from '@database/models/product.model';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { Op, WhereOptions } from 'sequelize';

export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  async findWithFilters(filters: {
    categoryId?: string;
    vendorId?: string;
    status?: 'DRAFT' | 'PENDING_APPROVAL' | 'LIVE' | 'REJECTED' | 'ARCHIVED';
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    limit: number;
    offset: number;
  }) {
    const where: any = {};

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.vendorId) {
      where.vendorId = filters.vendorId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${filters.search}%` } },
        { tags: { [Op.contains]: [filters.search] } },
      ];
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.basePrice = {};
      if (filters.minPrice !== undefined) {
        where.basePrice[Op.gte] = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.basePrice[Op.lte] = filters.maxPrice;
      }
    }

    let order: any = [['createdAt', 'DESC']];
    if (filters.sort === 'trending' || filters.sort === 'popular' || filters.sort === 'rating') {
      order = [['avgRating', 'DESC'], ['createdAt', 'DESC']];
    } else if (filters.sort === 'price_asc') {
      order = [['basePrice', 'ASC']];
    } else if (filters.sort === 'price_desc') {
      order = [['basePrice', 'DESC']];
    } else if (filters.sort === 'newest') {
      order = [['createdAt', 'DESC']];
    }

    return this.model.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      include: [
        { model: Category },
        { model: Vendor },
        'variants',
        'images',
      ],
      order,
    });
  }

  async findBySlug(slug: string) {
    return this.model.findOne({
      where: { slug },
      include: [
        { model: Category },
        { model: Vendor },
        'variants',
        'images',
      ],
    });
  }

  async findLiveByVendor(vendorId: string) {
    return this.model.findAll({
      where: { vendorId, status: 'LIVE' },
      include: ['variants', 'images'],
    });
  }
}

export const productsRepository = new ProductsRepository();
