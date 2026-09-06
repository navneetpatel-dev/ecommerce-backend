import { BaseRepository } from '@core/repository/BaseRepository';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';

export class ProductQnaRepository extends BaseRepository<ProductQuestion> {
  constructor() {
    super(ProductQuestion);
  }

  /** Public PDP Q&A — PUBLISHED only, most recent first, answers nested oldest-first. */
  async findPublishedForProduct(productId: string, limit: number, offset: number) {
    return this.model.findAndCountAll({
      where: { productId, status: PRODUCT_QUESTION_STATUS.PUBLISHED },
      include: [
        { association: 'user', attributes: ['id', 'name'] },
        {
          association: 'answers',
          separate: true,
          order: [['createdAt', 'ASC']],
          include: [{ association: 'author', attributes: ['id', 'name'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      distinct: true,
      col: 'id',
    });
  }

  /** Moderation queue — oldest first, so questions are worked in submission order. */
  async findPending(limit: number, offset: number) {
    return this.model.findAndCountAll({
      where: { status: PRODUCT_QUESTION_STATUS.PENDING },
      include: [
        { association: 'product', attributes: ['id', 'name'] },
        { association: 'user', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'ASC']],
      limit,
      offset,
      distinct: true,
      col: 'id',
    });
  }
}

export const productQnaRepository = new ProductQnaRepository();
