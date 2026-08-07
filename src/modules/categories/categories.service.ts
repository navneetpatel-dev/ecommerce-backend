import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { categoriesRepository } from './categories.repository';
import { Category } from '@database/models/category.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type { CreateCategoryRequest, UpdateCategoryRequest } from './categories.dto';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function assertValidParent(
  categoryId: string,
  parentId: string,
  transaction: Transaction,
) {
  if (parentId === categoryId) {
    throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
  }

  let cursor: string | null = parentId;
  const seen = new Set<string>([categoryId]);

  while (cursor) {
    if (seen.has(cursor)) {
      throw new ValidationError(ERROR_MESSAGES.CATEGORY_INVALID_PARENT);
    }
    seen.add(cursor);
    const node = await categoriesRepository.findById(cursor, { transaction });
    if (!node) throw new NotFoundError('Parent category');
    cursor = node.parentId;
  }
}

export class CategoriesService {
  async createCategory(data: CreateCategoryRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const slug = generateSlug(data.name);

      const existing = await categoriesRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.CATEGORY_NAME_EXISTS);
      }

      if (data.parentId) {
        const parent = await categoriesRepository.findById(data.parentId, { transaction: t });
        if (!parent) throw new NotFoundError('Parent category');
      }

      return categoriesRepository.create({
        name: data.name,
        slug,
        parentId: data.parentId ?? null,
        imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
        ...(data.status ? { status: data.status } : {}),
      }, { transaction: t });
    });
  }

  async getCategories() {
    return categoriesRepository.findTopLevel();
  }

  /** Flat admin list — all categories with parent name for the table. */
  async getCategoriesPaginated(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await Category.findAndCountAll({
      include: [
        {
          association: 'parent',
          attributes: ['id', 'name'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      categories: rows,
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
    return category;
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

      if (data.status !== undefined) {
        updateData.status = data.status;
      }

      await categoriesRepository.update(id, updateData, { transaction: t });
      return this.getCategoryById(id);
    });
  }

  async deleteCategory(id: string) {
    return sequelize.transaction(async (t: Transaction) => {
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

      await categoriesRepository.delete(id, { transaction: t });
    });
  }
}

export const categoriesService = new CategoriesService();
