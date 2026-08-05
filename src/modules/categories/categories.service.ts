import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { categoriesRepository } from './categories.repository';
import { Category } from '@database/models/category.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type { CreateCategoryRequest, UpdateCategoryRequest } from './categories.dto';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export class CategoriesService {
  async createCategory(data: CreateCategoryRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const slug = generateSlug(data.name);
      
      const existing = await categoriesRepository.findBySlug(slug);
      if (existing) {
        throw new ValidationError('Category name already exists');
      }

      if (data.parentId) {
        const parent = await categoriesRepository.findById(data.parentId, { transaction: t });
        if (!parent) throw new NotFoundError('Parent category');
      }

      return categoriesRepository.create({
        name: data.name,
        slug,
        parentId: data.parentId ?? null,
      }, { transaction: t });
    });
  }

  async getCategories() {
    return categoriesRepository.findTopLevel();
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

      const updateData: any = {};
      
      if (data.name) {
        const slug = generateSlug(data.name);
        const existing = await categoriesRepository.findBySlug(slug);
        if (existing && existing.id !== id) {
          throw new ValidationError('Category name already exists');
        }
        updateData.name = data.name;
        updateData.slug = slug;
      }

      if (data.parentId !== undefined) {
        if (data.parentId) {
          const parent = await categoriesRepository.findById(data.parentId, { transaction: t });
          if (!parent) throw new NotFoundError('Parent category');
          if (parent.id === id) throw new ValidationError('Category cannot be its own parent');
        }
        updateData.parentId = data.parentId;
      }

      await categoriesRepository.update(id, updateData, { transaction: t });
      return this.getCategoryById(id);
    });
  }

  async deleteCategory(id: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const category = await categoriesRepository.findWithChildren(id);
      if (!category) throw new NotFoundError('Category');

      const categoryWithChildren = await Category.findByPk(id, { include: ['children'], transaction: t });
      if (categoryWithChildren && (categoryWithChildren as any).children && (categoryWithChildren as any).children.length > 0) {
        throw new ValidationError('Cannot delete category with subcategories');
      }

      // Soft delete - can be restored later
      await categoriesRepository.softDelete(id, { transaction: t });
    });
  }
}

export const categoriesService = new CategoriesService();
