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
import { facetOptionValues } from './facetOptions';
import { assertAncestorsActive, assertValidParent } from './categoryHierarchy';
import { toPublicCategory } from './categoryPublic';
import { inCategoriesSql } from './categoryMembership';
import { assertSiblingNameFree } from './categoryNames';
import { TaxRule } from '@database/models/taxRule.model';
import { logAudit } from '@modules/audit/audit.service';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { toPlain, type PlainRow } from '@core/repository/toPlain';

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

/** Shoppers' products under these categories, by primary or secondary category. */
const inCategories = (ids: string[]) =>
  Sequelize.literal(inCategoriesSql('"Product"', ids.map((id) => sequelize.escape(id)).join(', ')));

type PlainCategory = PlainRow<Category, { children?: Category[]; attributes?: Array<PlainRow<CategoryAttribute>> }>;

/** A category as the API sends it: numbers as numbers, subcategories and filter keys alike. */
export type SerializedCategory = Omit<PlainCategory, 'children' | 'attributes' | 'commissionRate' | 'returnWindowDays' | 'defaultWarrantyMonths' | 'codEnabled'> & {
  commissionRate: number | null;
  returnWindowDays: number | null;
  defaultWarrantyMonths: number | null;
  codEnabled: boolean;
  children?: SerializedCategory[];
  attributes?: Array<PlainRow<CategoryAttribute> & { filterKey: string }>;
};

function serializeCategory(row: Category | Record<string, unknown>): SerializedCategory {
  const plain = toPlain<PlainCategory>(row);
  return {
    ...plain,
    commissionRate: plain.commissionRate != null ? Number(plain.commissionRate) : null,
    returnWindowDays: plain.returnWindowDays != null ? Number(plain.returnWindowDays) : null,
    defaultWarrantyMonths:
      plain.defaultWarrantyMonths != null ? Number(plain.defaultWarrantyMonths) : null,
    codEnabled: plain.codEnabled !== false,
    children: Array.isArray(plain.children)
      ? plain.children.map((child: Category) => serializeCategory(child))
      : plain.children,
    attributes: Array.isArray(plain.attributes)
      ? plain.attributes.map((attr) => ({
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
        if (data.status !== CATEGORY_STATUS.ARCHIVED) await assertAncestorsActive(data.parentId, t);
      }
      await assertSiblingNameFree(data.name, data.parentId ?? null, null, t);

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
          returnWindowDays: data.returnWindowDays ?? null,
          codEnabled: data.codEnabled ?? true,
          defaultWarrantyMonths: data.defaultWarrantyMonths ?? null,
          defaultWarrantyType: data.defaultWarrantyType ?? null,
          ...(data.status ? { status: data.status } : {}),
        },
        { transaction: t },
      );
      return serializeCategory(created);
    });
  }

  async getCategories() {
    const rows = await categoriesRepository.findActiveTree();
    return rows.map((row) => toPublicCategory(serializeCategory(row)));
  }

  async getCategoriesPaginated(query: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }) {
    const offset = paginationOffset(query.page, query.limit);
    // Public listing: only active categories (the admin screens use `listCategoriesForAdmin`).
    const where: Record<string, unknown> = { status: CATEGORY_STATUS.ACTIVE };
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
      order: [['displayOrder', 'ASC'], ['name', 'ASC'], ['id', 'ASC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      categories: rows.map((row) => toPublicCategory(serializeCategory(row))),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async getProductCount(id: string) {
    const category = await categoriesRepository.findById(id);
    if (!category) throw new NotFoundError('Category');
    const productCount = await categoriesRepository.countProducts(id);
    return { categoryId: id, productCount };
  }

  /** `publicView`: what shoppers may see (active only, no internal fields); the admin screens see all. */
  async getCategoryById(id: string, options: { publicView?: boolean } = {}): Promise<SerializedCategory> {
    const category = await categoriesRepository.findWithChildren(id, { activeChildrenOnly: options.publicView });
    if (!category) throw new NotFoundError('Category');
    if (options.publicView) {
      if (category.status !== CATEGORY_STATUS.ACTIVE) throw new NotFoundError('Category');
      return toPublicCategory(serializeCategory(category));
    }
    return serializeCategory(category);
  }

  /** Resolve hierarchical slug path (ACTIVE only for browse). */
  async resolveByPath(
    slugs: string[],
  ): Promise<SerializedCategory & { path: string; breadcrumb: Array<Pick<Category, 'id' | 'name' | 'slug'>> }> {
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
      ...toPublicCategory(serializeCategory(withAttrs ?? current!)),
      path,
      breadcrumb: breadcrumb.map((node) => ({
        id: node.id,
        name: node.name,
        slug: node.slug,
      })),
    };
  }

  async updateCategory(id: string, data: UpdateCategoryRequest) {
    await sequelize.transaction(async (t: Transaction) => {
      const category = await categoriesRepository.findById(id, { transaction: t });
      if (!category) throw new NotFoundError('Category');

      const updateData: Record<string, unknown> = {};

      if (data.name) {
        updateData.name = data.name;
        // The URL slug keeps working after a rename unless the admin asks for a new one.
        if (data.regenerateSlug) {
          const slug = generateSlug(data.name);
          const existing = await categoriesRepository.findBySlug(slug);
          if (existing && existing.id !== id) {
            throw new ValidationError(ERROR_MESSAGES.CATEGORY_NAME_EXISTS);
          }
          updateData.slug = slug;
        }
      }

      // Archiving takes subcategories out of the shop too, so it must be said out loud.
      if (data.status === CATEGORY_STATUS.ARCHIVED && category.status !== CATEGORY_STATUS.ARCHIVED) {
        const below = (await categoriesRepository.findDescendantIds(id)).filter((childId) => childId !== id);
        const active = below.length
          ? await Category.count({ where: { id: { [Op.in]: below }, status: CATEGORY_STATUS.ACTIVE }, transaction: t })
          : 0;
        if (active > 0 && !data.cascade) throw new ValidationError(ERROR_MESSAGES.CATEGORY_ARCHIVE_NEEDS_CASCADE);
        if (active > 0) {
          await Category.update({ status: CATEGORY_STATUS.ARCHIVED }, { where: { id: { [Op.in]: below } }, transaction: t });
        }
      }

      if (data.parentId !== undefined) {
        if (data.parentId) {
          await assertValidParent(id, data.parentId, t);
        }
        updateData.parentId = data.parentId;
      }
      if (data.name !== undefined || data.parentId !== undefined) {
        const parentId = data.parentId !== undefined ? data.parentId : category.parentId;
        await assertSiblingNameFree(data.name ?? category.name, parentId ?? null, id, t);
      }

      // Becoming active, or moving while active, needs active categories above.
      const nextStatus = data.status ?? category.status;
      if (nextStatus === CATEGORY_STATUS.ACTIVE && (data.status !== undefined || data.parentId !== undefined)) {
        await assertAncestorsActive(data.parentId !== undefined ? data.parentId : category.parentId, t);
      }

      if (data.imageUrl !== undefined) {
        updateData.imageUrl = data.imageUrl?.trim() ? data.imageUrl.trim() : null;
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
      if (data.seoTitle !== undefined) updateData.seoTitle = data.seoTitle;
      if (data.seoDescription !== undefined) updateData.seoDescription = data.seoDescription;
      if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;
      if (data.returnWindowDays !== undefined) updateData.returnWindowDays = data.returnWindowDays;
      if (data.codEnabled !== undefined) updateData.codEnabled = data.codEnabled;
      if (data.defaultWarrantyMonths !== undefined) {
        updateData.defaultWarrantyMonths = data.defaultWarrantyMonths;
      }
      if (data.defaultWarrantyType !== undefined) {
        updateData.defaultWarrantyType = data.defaultWarrantyType;
      }

      await categoriesRepository.update(id, updateData, { transaction: t });

      if (data.imageUrl !== undefined) {
        const nextUrl = data.imageUrl?.trim() ? data.imageUrl.trim() : null;
        await deleteS3ObjectIfReplaced(category.imageUrl, nextUrl);
      }
    });
    return this.getCategoryById(id);
  }

  async reorderCategories(orderedIds: string[]) {
    return sequelize.transaction(async (t: Transaction) => {
      // A whole-list renumbering only makes sense among siblings (use /move for anything else).
      const parents = new Set((await Category.findAll({ where: { id: { [Op.in]: orderedIds } }, attributes: ['parentId'], transaction: t })).map((row) => row.parentId ?? null));
      if (parents.size > 1) throw new ValidationError(ERROR_MESSAGES.CATEGORY_REORDER_MIXED_PARENTS);
      for (let index = 0; index < orderedIds.length; index += 1) {
        const id = orderedIds[index]!;
        const row = await categoriesRepository.findById(id, { transaction: t });
        if (!row) throw new NotFoundError('Category');
        await categoriesRepository.update(id, { displayOrder: index }, { transaction: t });
      }
      return { orderedIds };
    });
  }

  async deleteCategory(id: string, actorId?: string) {
    const imageUrl = await sequelize.transaction(async (t: Transaction) => {
      const category = await categoriesRepository.findWithChildren(id);
      if (!category) throw new NotFoundError('Category');

      const children = (category as Category & { children?: Category[] }).children ?? [];
      if (children.length > 0) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_HAS_SUBCATEGORIES);
      }

      // Deleted products still point at their category, so they count too.
      const productCount = await categoriesRepository.countProducts(id);
      if (productCount > 0) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_HAS_PRODUCTS);
      }

      // Its tax rule goes with it: left behind, the database would turn it into a second default rule.
      const taxRule = await TaxRule.findOne({ where: { categoryId: id }, transaction: t });
      if (taxRule) {
        await taxRule.destroy({ transaction: t });
        if (actorId) {
          await logAudit({
            actorId,
            action: 'TAX_RULE_DELETED',
            entityType: 'TaxRule',
            entityId: taxRule.id,
            metadata: { categoryName: category.name, gstPercentage: Number(taxRule.gstPercentage), reason: 'category deleted' },
            transaction: t,
          });
        }
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
      const optionValues = facetOptionValues(attr);

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
      // Option names match whatever the capitals; a value is a string or a list of strings.
      literals.push(
        Sequelize.literal(`EXISTS (
          SELECT 1 FROM product_variants pv,
            jsonb_each(CASE WHEN jsonb_typeof(pv.attributes) = 'object' THEN pv.attributes ELSE '{}'::jsonb END) opt
          WHERE pv."productId" = "Product"."id"
            AND pv."deletedAt" IS NULL
            AND LOWER(opt.key) = LOWER('${name}')
            AND (
              LOWER(opt.value #>> '{}') IN (${vals})
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(opt.value) = 'array' THEN opt.value ELSE '[]'::jsonb END
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
      where: { [Op.and]: [inCategories(categoryIds), ...literals] },
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
      where: { [Op.and]: [inCategories(categoryIds), ...literals] },
      distinct: true,
      col: 'Product.id',
    });
  }
}

export const categoriesService = new CategoriesService();
