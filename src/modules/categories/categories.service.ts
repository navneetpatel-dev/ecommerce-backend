import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { CATEGORY_STATUS } from '@core/constants/statuses';
import {
  cascadeDeleteEntityMedia,
  deleteS3ObjectIfReplaced,
  S3_ENTITY_TYPES,
} from '@core/s3';
import { categoriesRepository } from './categories.repository';
import { Category } from '@database/models/category.model';
import { CategoryAttribute } from '@database/models/categoryAttribute.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@database/models';
import { Op, Sequelize, type Transaction } from 'sequelize';
import type {
  CreateCategoryAttributeRequest,
  CreateCategoryRequest,
  UpdateCategoryAttributeRequest,
  UpdateCategoryRequest,
} from './categories.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

const MAX_CATEGORY_DEPTH = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function attributeFilterKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

async function getCategoryDepth(categoryId: string | null, transaction?: Transaction): Promise<number> {
  if (!categoryId) return 0;
  let depth = 0;
  let cursor: string | null = categoryId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
    seen.add(cursor);
    depth += 1;
    const node = await categoriesRepository.findById(cursor, { transaction });
    if (!node) throw new NotFoundError('Parent category');
    cursor = node.parentId;
  }
  return depth;
}

/** Height of a subtree rooted at categoryId (leaf = 1). */
async function getSubtreeHeight(categoryId: string, transaction?: Transaction): Promise<number> {
  const children = await Category.findAll({
    where: { parentId: categoryId },
    attributes: ['id'],
    transaction,
  });
  if (!children.length) return 1;
  let maxChild = 0;
  for (const child of children) {
    maxChild = Math.max(maxChild, await getSubtreeHeight(child.id, transaction));
  }
  return 1 + maxChild;
}

async function assertValidParent(
  categoryId: string | null,
  parentId: string,
  transaction: Transaction,
) {
  if (categoryId && parentId === categoryId) {
    throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
  }

  let cursor: string | null = parentId;
  const seen = new Set<string>(categoryId ? [categoryId] : []);

  while (cursor) {
    if (seen.has(cursor)) {
      throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
    }
    seen.add(cursor);
    const node = await categoriesRepository.findById(cursor, { transaction });
    if (!node) throw new NotFoundError('Parent category');
    cursor = node.parentId;
  }

  const parentDepth = await getCategoryDepth(parentId, transaction);
  const subtreeHeight = categoryId ? await getSubtreeHeight(categoryId, transaction) : 1;
  if (parentDepth + subtreeHeight > MAX_CATEGORY_DEPTH) {
    throw new ValidationError(ERROR_MESSAGES.CATEGORY_MAX_DEPTH);
  }
}

function serializeCategory(row: Category | Record<string, unknown>) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    ...plain,
    commissionRate: plain.commissionRate != null ? Number(plain.commissionRate) : null,
    children: Array.isArray(plain.children)
      ? plain.children.map((child: Category) => serializeCategory(child))
      : plain.children,
    attributes: Array.isArray(plain.attributes)
      ? plain.attributes.map((attr: any) => ({
          ...attr,
          filterKey: attributeFilterKey(attr.name),
        }))
      : plain.attributes,
  };
}

export class CategoriesService {
  /** Ancestor chain from leaf to root (inclusive), leaf first. */
  async walkCategoryAncestors(categoryId: string, transaction?: Transaction): Promise<Category[]> {
    const chain: Category[] = [];
    let cursor: string | null = categoryId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const node = await categoriesRepository.findById(cursor, { transaction });
      if (!node) break;
      chain.push(node);
      cursor = node.parentId;
    }
    return chain;
  }

  async resolveCommissionRate(
    categoryId: string | null | undefined,
    vendorCommissionRate: number | null | undefined,
    platformDefault: number,
  ): Promise<number> {
    if (categoryId) {
      const chain = await this.walkCategoryAncestors(categoryId);
      for (const node of chain) {
        if (node.commissionRate != null) {
          return Number(node.commissionRate);
        }
      }
    }
    if (vendorCommissionRate != null) return Number(vendorCommissionRate);
    return Number(platformDefault);
  }

  async assertActiveCategory(categoryId: string, transaction?: Transaction) {
    const category = await categoriesRepository.findById(categoryId, { transaction });
    if (!category) throw new NotFoundError('Category');
    if (category.status !== CATEGORY_STATUS.ACTIVE) {
      throw new ValidationError(ERROR_MESSAGES.CATEGORY_INACTIVE);
    }
    return category;
  }

  /** Customer category browse — missing or ARCHIVED looks like not found. */
  async assertBrowseableCategory(categoryId: string) {
    return this.findActiveCategoryByIdOrSlug(categoryId);
  }

  async createCategory(data: CreateCategoryRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const slug = generateSlug(data.name);

      const existing = await categoriesRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_NAME_EXISTS);
      }

      if (data.parentId) {
        await assertValidParent(null, data.parentId, t);
      }

      const created = await categoriesRepository.create(
        {
          name: data.name,
          slug,
          parentId: data.parentId ?? null,
          imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
          displayOrder: data.displayOrder ?? 0,
          seoTitle: data.seoTitle ?? null,
          seoDescription: data.seoDescription ?? null,
          commissionRate: data.commissionRate ?? null,
          ...(data.status ? { status: data.status } : {}),
        },
        { transaction: t },
      );
      return serializeCategory(created);
    });
  }

  async getCategories() {
    const rows = await categoriesRepository.findActiveTree();
    return rows.map((row) => serializeCategory(row));
  }

  async getCategoriesPaginated(query: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }) {
    const offset = paginationOffset(query.page, query.limit);
    const where: Record<string, unknown> = {};
    if (query.status) {
      where.status = query.status;
    }
    const search = query.search?.trim();
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }

    const { rows, count } = await Category.findAndCountAll({
      where,
      include: [
        {
          association: 'parent',
          attributes: ['id', 'name', 'slug'],
          required: false,
        },
      ],
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      categories: rows.map((row) => serializeCategory(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async getProductCount(id: string) {
    const category = await categoriesRepository.findById(id);
    if (!category) throw new NotFoundError('Category');
    const productCount = await categoriesRepository.countProducts(id);
    return { categoryId: id, productCount };
  }

  async getCategoryById(id: string) {
    const category = await categoriesRepository.findWithChildren(id);
    if (!category) throw new NotFoundError('Category');
    return serializeCategory(category);
  }

  /** Resolve hierarchical slug path (ACTIVE only for browse). */
  async resolveByPath(slugs: string[]) {
    if (!slugs.length) throw new NotFoundError('Category');

    let parentId: string | null = null;
    let current: Category | null = null;
    const breadcrumb: Category[] = [];

    for (const slug of slugs) {
      current = await Category.findOne({
        where: {
          slug,
          parentId,
          status: CATEGORY_STATUS.ACTIVE,
        },
      });
      if (!current) throw new NotFoundError('Category');
      breadcrumb.push(current);
      parentId = current.id;
    }

    const withAttrs = await categoriesRepository.findWithChildren(current!.id, {
      activeChildrenOnly: true,
    });
    const path = breadcrumb.map((node) => node.slug).join('/');
    return {
      ...serializeCategory(withAttrs ?? current!),
      path,
      breadcrumb: breadcrumb.map((node) => ({
        id: node.id,
        name: node.name,
        slug: node.slug,
      })),
    };
  }

  async updateCategory(id: string, data: UpdateCategoryRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const category = await categoriesRepository.findById(id, { transaction: t });
      if (!category) throw new NotFoundError('Category');

      const updateData: Record<string, unknown> = {};

      if (data.name) {
        const slug = generateSlug(data.name);
        const existing = await categoriesRepository.findBySlug(slug);
        if (existing && existing.id !== id) {
          throw new ValidationError(ERROR_MESSAGES.CATEGORY_NAME_EXISTS);
        }
        updateData.name = data.name;
        updateData.slug = slug;
      }

      if (data.parentId !== undefined) {
        if (data.parentId) {
          await assertValidParent(id, data.parentId, t);
        }
        updateData.parentId = data.parentId;
      }

      if (data.imageUrl !== undefined) {
        updateData.imageUrl = data.imageUrl?.trim() ? data.imageUrl.trim() : null;
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
      if (data.seoTitle !== undefined) updateData.seoTitle = data.seoTitle;
      if (data.seoDescription !== undefined) updateData.seoDescription = data.seoDescription;
      if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;

      await categoriesRepository.update(id, updateData, { transaction: t });

      if (data.imageUrl !== undefined) {
        const nextUrl = data.imageUrl?.trim() ? data.imageUrl.trim() : null;
        await deleteS3ObjectIfReplaced(category.imageUrl, nextUrl);
      }

      return this.getCategoryById(id);
    });
  }

  async reorderCategories(orderedIds: string[]) {
    return sequelize.transaction(async (t: Transaction) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        const id = orderedIds[index]!;
        const row = await categoriesRepository.findById(id, { transaction: t });
        if (!row) throw new NotFoundError('Category');
        await categoriesRepository.update(id, { displayOrder: index }, { transaction: t });
      }
      return { orderedIds };
    });
  }

  async reassignProducts(fromCategoryId: string, toCategoryId: string) {
    if (fromCategoryId === toCategoryId) {
      throw new ValidationError(ERROR_MESSAGES.CATEGORY_REASSIGN_SAME);
    }
    return sequelize.transaction(async (t: Transaction) => {
      await this.assertActiveCategory(toCategoryId, t);
      const from = await categoriesRepository.findById(fromCategoryId, { transaction: t });
      if (!from) throw new NotFoundError('Category');

      const [updatedCount] = await Product.update(
        { categoryId: toCategoryId },
        { where: { categoryId: fromCategoryId }, transaction: t },
      );
      return { fromCategoryId, toCategoryId, updatedCount };
    });
  }

  async deleteCategory(id: string) {
    const imageUrl = await sequelize.transaction(async (t: Transaction) => {
      const category = await categoriesRepository.findWithChildren(id);
      if (!category) throw new NotFoundError('Category');

      const children = (category as Category & { children?: Category[] }).children ?? [];
      if (children.length > 0) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_HAS_SUBCATEGORIES);
      }

      const productCount = await categoriesRepository.countProducts(id);
      if (productCount > 0) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_HAS_PRODUCTS);
      }

      const url = category.imageUrl;
      await categoriesRepository.delete(id, { transaction: t });
      return url;
    });
    await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.CATEGORIES, id, [imageUrl]);
  }

  async listAttributes(categoryId: string) {
    const category = await categoriesRepository.findById(categoryId);
    if (!category) throw new NotFoundError('Category');
    const rows = await CategoryAttribute.findAll({
      where: { categoryId },
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    return rows.map((row) => {
      const plain = row.get({ plain: true });
      return { ...plain, filterKey: attributeFilterKey(plain.name) };
    });
  }

  async createAttribute(categoryId: string, data: CreateCategoryAttributeRequest) {
    const category = await categoriesRepository.findById(categoryId);
    if (!category) throw new NotFoundError('Category');

    const existing = await CategoryAttribute.findOne({
      where: { categoryId, name: data.name },
    });
    if (existing) throw new ValidationError(ERROR_MESSAGES.CATEGORY_ATTRIBUTE_EXISTS);

    const created = await CategoryAttribute.create({
      categoryId,
      name: data.name,
      type: data.type,
      options: data.options ?? [],
      displayOrder: data.displayOrder ?? 0,
    });
    const plain = created.get({ plain: true });
    return { ...plain, filterKey: attributeFilterKey(plain.name) };
  }

  async updateAttribute(
    categoryId: string,
    attributeId: string,
    data: UpdateCategoryAttributeRequest,
  ) {
    const attr = await CategoryAttribute.findOne({ where: { id: attributeId, categoryId } });
    if (!attr) throw new NotFoundError('CategoryAttribute');

    if (data.name && data.name !== attr.name) {
      const existing = await CategoryAttribute.findOne({
        where: { categoryId, name: data.name },
      });
      if (existing) throw new ValidationError(ERROR_MESSAGES.CATEGORY_ATTRIBUTE_EXISTS);
    }

    await attr.update({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.options !== undefined ? { options: data.options } : {}),
      ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
    });
    const plain = attr.get({ plain: true });
    return { ...plain, filterKey: attributeFilterKey(plain.name) };
  }

  async reorderAttributes(categoryId: string, orderedIds: string[]) {
    const category = await categoriesRepository.findById(categoryId);
    if (!category) throw new NotFoundError('Category');

    return sequelize.transaction(async (t: Transaction) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        const id = orderedIds[index]!;
        const attr = await CategoryAttribute.findOne({
          where: { id, categoryId },
          transaction: t,
        });
        if (!attr) throw new NotFoundError('CategoryAttribute');
        await attr.update({ displayOrder: index }, { transaction: t });
      }
      return { orderedIds };
    });
  }

  async deleteAttribute(categoryId: string, attributeId: string) {
    const attr = await CategoryAttribute.findOne({ where: { id: attributeId, categoryId } });
    if (!attr) throw new NotFoundError('CategoryAttribute');
    await attr.destroy();
  }

  /**
   * Facets for category browse: AND across attributes, OR within multi-value.
   * Options with zero results given current selection are returned disabled (not hidden).
   * Counts reuse Product.scope('customerVisible') — no second visibility rule.
   */
  async getFacets(
    categoryIdOrSlug: string,
    selected: Record<string, string[]>,
  ): Promise<{
    categoryId: string;
    facets: Array<{
      id: string;
      name: string;
      filterKey: string;
      type: string;
      options: Array<{ value: string; count: number; disabled: boolean }>;
    }>;
  }> {
    const category = await this.findActiveCategoryByIdOrSlug(categoryIdOrSlug);

    const attributes = await CategoryAttribute.findAll({
      where: { categoryId: category.id },
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    const categoryIds = await categoriesRepository.findDescendantIds(category.id);

    const facets = [];
    for (const attr of attributes) {
      const filterKey = attributeFilterKey(attr.name);
      const optionValues =
        attr.type === 'BOOLEAN'
          ? ['true', 'false']
          : (attr.options ?? []).map((opt) => String(opt));

      const options = [];
      for (const value of optionValues) {
        const count = await this.countVisibleProductsForFacet(
          categoryIds,
          attributes,
          selected,
          filterKey,
          value,
        );
        options.push({
          value,
          count,
          disabled: count === 0,
        });
      }

      facets.push({
        id: attr.id,
        name: attr.name,
        filterKey,
        type: attr.type,
        options,
      });
    }

    return { categoryId: category.id, facets };
  }

  private async findActiveCategoryByIdOrSlug(categoryIdOrSlug: string): Promise<Category> {
    const category = isUuid(categoryIdOrSlug)
      ? await categoriesRepository.findById(categoryIdOrSlug)
      : await categoriesRepository.findBySlug(categoryIdOrSlug);
    if (!category || category.status !== CATEGORY_STATUS.ACTIVE) {
      throw new NotFoundError('Category');
    }
    return category;
  }

  /** EXISTS literals for variant attribute filters (AND across keys, OR within values). */
  private attributeFilterLiterals(
    attributes: CategoryAttribute[],
    selected: Record<string, string[]>,
  ): ReturnType<typeof Sequelize.literal>[] {
    const attrByKey = new Map(
      attributes.map((attr) => [attributeFilterKey(attr.name), attr] as const),
    );
    const literals: ReturnType<typeof Sequelize.literal>[] = [];

    for (const [key, values] of Object.entries(selected)) {
      if (!values?.length) continue;
      const attr = attrByKey.get(key);
      if (!attr) continue;
      const name = escapeSqlString(attr.name);
      const vals = values.map((value) => `'${escapeSqlString(value.toLowerCase())}'`).join(', ');
      literals.push(
        Sequelize.literal(`EXISTS (
          SELECT 1 FROM product_variants pv
          WHERE pv."productId" = "Product"."id"
            AND pv."deletedAt" IS NULL
            AND (
              LOWER(pv.attributes ->> '${name}') IN (${vals})
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE
                    WHEN jsonb_typeof(pv.attributes -> '${name}') = 'array'
                    THEN pv.attributes -> '${name}'
                    ELSE '[]'::jsonb
                  END
                ) elem
                WHERE LOWER(elem) IN (${vals})
              )
            )
        )`),
      );
    }
    return literals;
  }

  /**
   * Product IDs in category (+ descendants) matching facet selection.
   * Returns null when no recognized attribute filters apply (do not restrict by id).
   */
  async findVisibleProductIdsForFacets(
    categoryIds: string[],
    attributeCategoryId: string,
    selected: Record<string, string[]>,
  ): Promise<string[] | null> {
    const attributes = await CategoryAttribute.findAll({
      where: { categoryId: attributeCategoryId },
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    const literals = this.attributeFilterLiterals(attributes, selected);
    if (!literals.length) return null;

    const rows = await Product.scope('customerVisible').findAll({
      attributes: ['id'],
      where: {
        categoryId: { [Op.in]: categoryIds },
        [Op.and]: literals,
      },
    });
    return rows.map((row) => row.id);
  }

  private async countVisibleProductsForFacet(
    categoryIds: string[],
    attributes: CategoryAttribute[],
    selected: Record<string, string[]>,
    probingKey: string,
    probingValue: string,
  ): Promise<number> {
    const effective: Record<string, string[]> = { ...selected };
    effective[probingKey] = [probingValue];
    const literals = this.attributeFilterLiterals(attributes, effective);

    return Product.scope('customerVisible').count({
      where: {
        categoryId: { [Op.in]: categoryIds },
        ...(literals.length ? { [Op.and]: literals } : {}),
      },
      distinct: true,
      col: 'Product.id',
    });
  }
}

export const categoriesService = new CategoriesService();
