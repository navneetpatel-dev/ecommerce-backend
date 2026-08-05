import { BaseRepository } from '@core/repository/BaseRepository';
import { Category } from '@database/models/category.model';

export class CategoriesRepository extends BaseRepository<Category> {
  constructor() {
    super(Category);
  }

  async findBySlug(slug: string) {
    return this.model.findOne({ where: { slug } });
  }

  async findTopLevel() {
    return this.model.findAll({ where: { parentId: null }, include: ['children'] });
  }

  async findWithChildren(id: string) {
    return this.model.findByPk(id, { include: ['children', 'parent'] });
  }
}

export const categoriesRepository = new CategoriesRepository();
