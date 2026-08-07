import { BaseRepository } from '@core/repository/BaseRepository';
import { Category } from '@database/models/category.model';
import { Product } from '@database/models/product.model';
import { CATEGORY_STATUS } from '@core/constants/statuses';
import { Op } from 'sequelize';

export class CategoriesRepository extends BaseRepository<Category> {
  constructor() {
    super(Category);
  }

  async findBySlug(slug: string) {
    return this.model.findOne({ where: { slug } });
  }

  /** Customer-facing nav — ACTIVE tree up to 3 levels, ordered by displayOrder. */
  async findActiveTree() {
    return this.model.findAll({
      where: { parentId: null, status: CATEGORY_STATUS.ACTIVE },
      order: [
        ['displayOrder', 'ASC'],
        ['name', 'ASC'],
        [{ model: Category, as: 'children' }, 'displayOrder', 'ASC'],
        [{ model: Category, as: 'children' }, 'name', 'ASC'],
        [{ model: Category, as: 'children' }, { model: Category, as: 'children' }, 'displayOrder', 'ASC'],
        [{ model: Category, as: 'children' }, { model: Category, as: 'children' }, 'name', 'ASC'],
      ],
      include: [
        {
          association: 'children',
          required: false,
          where: { status: CATEGORY_STATUS.ACTIVE },
          include: [
            {
              association: 'children',
              required: false,
              where: { status: CATEGORY_STATUS.ACTIVE },
            },
          ],
        },
      ],
    });
  }

  /** @deprecated use findActiveTree */
  async findTopLevel() {
    return this.findActiveTree();
  }

  async findWithChildren(id: string) {
    return this.model.findByPk(id, {
      include: [
        'parent',
        {
          association: 'children',
          include: ['children'],
        },
        {
          association: 'attributes',
          separate: true,
          order: [
            ['displayOrder', 'ASC'],
            ['name', 'ASC'],
          ],
        },
      ],
    });
  }

  async countProducts(categoryId: string) {
    return Product.count({ where: { categoryId } });
  }

  async findDescendantIds(rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length) {
      const children = await this.model.findAll({
        where: { parentId: { [Op.in]: frontier } },
        attributes: ['id'],
      });
      frontier = children.map((row) => row.id);
      ids.push(...frontier);
    }
    return ids;
  }
}

export const categoriesRepository = new CategoriesRepository();
