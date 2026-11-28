import { BaseRepository } from '@core/repository/BaseRepository';
import { Product } from '@database/models/product.model';
import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { Op, type Includeable, type Order } from 'sequelize';
import { REVIEW_STATUS, type ProductStatus } from '@core/constants/statuses';
import { TEAM_VENDOR_ATTRIBUTES } from './productPublicFields';
import { inCategoriesSql } from '@modules/categories/categoryMembership';

/** The GST-inclusive price customers see; filter and sort by it so they match the cards. */
const displayPriceColumn = sequelize.fn('COALESCE', sequelize.col('Product.displayPrice'), sequelize.col('Product.basePrice'));

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
  inStock?: boolean;
  /** Shopper lists: "in stock" counts only variants that may be sold (within the MRP). */
  sellableOnly?: boolean;
  rating?: number;
  sort?: string;
  excludeProductId?: string;
  limit: number;
  offset: number;
};

const categoryWithAncestors: Includeable = {
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
};

const secondaryCategoriesInclude: Includeable = {
  association: 'secondaryCategories',
  attributes: ['id', 'name', 'slug', 'status'],
  through: { attributes: [] },
  required: false,
};

function buildListWhere(filters: ProductListFilters) {
  const where: Record<string | symbol, unknown> = {};
  /** Adds a condition that must hold besides the others. */
  const also = (condition: unknown) => {
    where[Op.and] = [...((where[Op.and] as unknown[] | undefined) ?? []), condition];
  };

  if (filters.productIds?.length) {
    where.id = { [Op.in]: filters.productIds };
  }
  const categoryIds = filters.categoryIds?.length ? filters.categoryIds : filters.categoryId ? [filters.categoryId] : [];
  if (categoryIds.length && filters.sellableOnly) {
    // Shoppers find secondary tags too. A condition of its own, so the shop's rule that the
    // primary category is active still applies (a `categoryId` filter would replace it).
    const ids = categoryIds.map((id) => sequelize.escape(id)).join(', ');
    also(sequelize.literal(inCategoriesSql('"Product"', ids)));
  } else if (categoryIds.length) {
    where.categoryId = { [Op.in]: categoryIds };
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

  // On the GST-inclusive price the cards show.
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const range: Record<symbol, number> = {};
    if (filters.minPrice !== undefined) range[Op.gte] = filters.minPrice;
    if (filters.maxPrice !== undefined) range[Op.lte] = filters.maxPrice;
    also(sequelize.where(displayPriceColumn, range));
  }

  if (filters.rating !== undefined) {
    where.avgRating = { [Op.gte]: filters.rating };
  }

  if (filters.inStock) {
    also(
      sequelize.literal(
        `EXISTS (SELECT 1 FROM product_variants pv WHERE pv."productId" = "Product"."id" AND pv."deletedAt" IS NULL AND pv.stock > 0${
          filters.sellableOnly ? ' AND pv."aboveMrp" = false' : ''
        })`,
      ),
    );
  }

  return where;
}

/**
 * Every sort ends on the primary key. Rows that tie on the sort columns (same rating,
 * same createdAt, same price) otherwise come back in a different order per OFFSET
 * query, so pages overlap and some products never appear.
 */
export function buildListOrder(sort?: string): Array<[unknown, 'ASC' | 'DESC']> {
  const tiebreak: [string, 'ASC'] = ['id', 'ASC'];
  if (sort === 'trending' || sort === 'popular' || sort === 'rating') {
    return [['avgRating', 'DESC'], ['createdAt', 'DESC'], tiebreak];
  }
  if (sort === 'price_asc') return [[displayPriceColumn, 'ASC'], tiebreak];
  if (sort === 'price_desc') return [[displayPriceColumn, 'DESC'], tiebreak];
  return [['createdAt', 'DESC'], tiebreak];
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
        categoryWithAncestors,
        secondaryCategoriesInclude,
        { model: Vendor, as: 'vendor', attributes: TEAM_VENDOR_ATTRIBUTES },
        'variants',
        'images',
      ],
      order: buildListOrder(filters.sort) as Order,
    });
  }

  /**
   * Customer-facing list — Product.status LIVE AND Vendor.status APPROVED.
   * Do not use for admin/vendor dashboards.
   */
  async findVisibleList(filters: Omit<ProductListFilters, 'status'>) {
    const where = buildListWhere({ ...filters, sellableOnly: true });
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
        categoryWithAncestors,
        secondaryCategoriesInclude,
        'variants',
        'images',
      ],
      order: buildListOrder(filters.sort) as Order,
    });
  }

  /** Whose product it is: null for none, undefined when there is no such product. */
  async findOwnerVendorId(where: { id: string } | { slug: string }): Promise<string | null | undefined> {
    const row = await this.model.findOne({ where, attributes: ['vendorId'] });
    return row ? row.vendorId : undefined;
  }

  async findBySlug(slug: string) {
    return this.model.findOne({
      where: { slug },
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors,
        secondaryCategoriesInclude,
        { model: Vendor, as: 'vendor', attributes: TEAM_VENDOR_ATTRIBUTES },
        'variants',
        'images',
      ],
    });
  }

  async findVisibleById(id: string) {
    return Product.scope('customerVisible').findByPk(id, {
      attributes: { include: [reviewCountLiteral] },
      include: [
        categoryWithAncestors,
        secondaryCategoriesInclude,
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
        categoryWithAncestors,
        secondaryCategoriesInclude,
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
        categoryWithAncestors,
        secondaryCategoriesInclude,
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
