import { BaseRepository } from '@core/repository/BaseRepository';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { CATEGORY_STATUS } from '@core/constants/statuses';

export class CategoriesRepository extends BaseRepository<Category> {
  constructor() {
    super(Category);
  }

  async findBySlug(slug: string) {
    return this.model.findOne({ where: { slug } });
  }

  /** Customer-facing nav/filters — ACTIVE only. Archiving does not hide products underneath. */
  async findTopLevel() {
    return this.model.findAll({
      where: { parentId: null, status: CATEGORY_STATUS.ACTIVE },
      include: [{
        association: 'children',
        required: false,
        where: { status: CATEGORY_STATUS.ACTIVE },
      }],
    });
  }

  async findWithChildren(id: string) {
    return this.model.findByPk(id, { include: ['children', 'parent'] });
  }

  async countProducts(categoryId: string) {
    return Product.count({ where: { categoryId } });
  }
}

export const categoriesRepository = new CategoriesRepository();
