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

type ProductListFilters = {
  categoryId?: string;
  categoryIds?: string[];
  productIds?: string[];
  vendorId?: string;
  status?: ProductStatus;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  sort?: string;
  excludeProductId?: string;
  limit: number;
  offset: number;
};

const categoryWithAncestors = {
  model: Category,
  include: [
    {
      association: 'parent',
      required: false,
      include: [
        {
          association: 'parent',
          required: false,
        },
      ],
    },
  ],
} as const;

const secondaryCategoriesInclude = {
  association: 'secondaryCategories',
  attributes: ['id', 'name', 'slug', 'status'],
  through: { attributes: [] },
  required: false,
} as const;

function buildListWhere(filters: ProductListFilters) {
  const where: any = {};

  if (filters.productIds?.length) {
    where.id = { [Op.in]: filters.productIds };
  }
  if (filters.categoryIds?.length) {
    where.categoryId = { [Op.in]: filters.categoryIds };
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }
  if (filters.vendorId) where.vendorId = filters.vendorId;
  if (filters.status) where.status = filters.status;
  if (filters.excludeProductId) {
    where.id = where.id
      ? { [Op.and]: [where.id, { [Op.ne]: filters.excludeProductId }] }
      : { [Op.ne]: filters.excludeProductId };
  }

  if (filters.search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.search}%` } },
      { tags: { [Op.contains]: [filters.search] } },
    ];
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.basePrice = {};
    if (filters.minPrice !== undefined) where.basePrice[Op.gte] = filters.minPrice;
    if (filters.maxPrice !== undefined) where.basePrice[Op.lte] = filters.maxPrice;
  }

  if (filters.rating !== undefined) {
    where.avgRating = { [Op.gte]: filters.rating };
  }

  return where;
}

function buildListOrder(sort?: string) {
  if (sort === 'trending' || sort === 'popular' || sort === 'rating') {
    return [['avgRating', 'DESC'], ['createdAt', 'DESC']];
  }
  if (sort === 'price_asc') return [['basePrice', 'ASC']];
  if (sort === 'price_desc') return [['basePrice', 'DESC']];
  return [['createdAt', 'DESC']];
}

export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  /** Admin/vendor — unscoped. */
  async findWithFilters(filters: ProductListFilters) {
    return this.model.findAndCountAll({
      where: buildListWhere(filters),
      limit: filters.limit,
      offset: filters.offset,
      distinct: true,
      col: 'id',
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        { model: Vendor, as: 'vendor' },
        'variants',
        'images',
      ],
      order: buildListOrder(filters.sort) as any,
    });
  }

  /**
   * Customer-facing list — Product.status LIVE AND Vendor.status APPROVED.
   * Do not use for admin/vendor dashboards.
   */
  async findVisibleList(filters: Omit<ProductListFilters, 'status'>) {
    const where = buildListWhere({ ...filters });
    // Scope already enforces LIVE; never let a client override status here.
    delete (where as { status?: ProductStatus }).status;

    return Product.scope('customerVisible').findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      distinct: true,
      col: 'id',
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        'variants',
        'images',
      ],
      order: buildListOrder(filters.sort) as any,
    });
  }

  async findBySlug(slug: string) {
    return this.model.findOne({
      where: { slug },
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        { model: Vendor, as: 'vendor' },
        'variants',
        'images',
      ],
    });
  }

  async findVisibleById(id: string) {
    return Product.scope('customerVisible').findByPk(id, {
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        'variants',
        'images',
      ],
    });
  }

  async findVisibleBySlug(slug: string) {
    return Product.scope('customerVisible').findOne({
      where: { slug },
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        'variants',
        'images',
      ],
    });
  }

  /** Customer-facing lookup by id set — used to hydrate recently-viewed history. Order is not guaranteed. */
  async findVisibleByIds(ids: string[]) {
    if (!ids.length) return [];
    return Product.scope('customerVisible').findAll({
      where: { id: { [Op.in]: ids } },
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors as any,
        secondaryCategoriesInclude as any,
        'variants',
        'images',
      ],
    });
  }

  async findLiveByVendor(vendorId: string) {
    return Product.scope('customerVisible').findAll({
      where: { vendorId },
      include: ['variants', 'images'],
    });
  }
}

export const productsRepository = new ProductsRepository();
