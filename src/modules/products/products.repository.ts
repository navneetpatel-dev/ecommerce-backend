import { BaseRepository } from '@core/repository/BaseRepository';
import { Product } from '@database/models/product.model';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { Op } from 'sequelize';
import { PRODUCT_STATUS, REVIEW_STATUS, type ProductStatus } from '@core/constants/statuses';

const reviewCountLiteral = [
  sequelize.literal(`(
    SELECT COUNT(*)::int
    FROM reviews AS r
    WHERE r."productId" = "Product"."id"
      AND r.status = '${REVIEW_STATUS.APPROVED}'
      AND r."deletedAt" IS NULL
  )`),
  'reviewCount',
] as const;

export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  async findWithFilters(filters: {
    categoryId?: string;
    vendorId?: string;
    status?: ProductStatus;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    rating?: number;
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

    if (filters.rating !== undefined) {
      where.avgRating = { [Op.gte]: filters.rating };
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
      attributes: { include: [reviewCountLiteral] },
      include: [
        { model: Category },
        { model: Vendor, as: 'vendor' },
        'variants',
        'images',
      ],
      order,
    });
  }

  async findBySlug(slug: string) {
    return this.model.findOne({
      where: { slug },
      attributes: { include: [reviewCountLiteral] },
      include: [
        { model: Category },
        { model: Vendor, as: 'vendor' },
        'variants',
        'images',
      ],
    });
  }

  async findLiveByVendor(vendorId: string) {
    return this.model.findAll({
      where: { vendorId, status: PRODUCT_STATUS.LIVE },
      include: ['variants', 'images'],
    });
  }
}

export const productsRepository = new ProductsRepository();
