import { BaseRepository } from '@core/repository/BaseRepository';
import { Review } from '@database/models/review.model';
import { Product } from '@database/models/product.model';
import { WhereOptions } from 'sequelize';
import { REVIEW_STATUS, type ReviewStatus } from '@core/constants/statuses';

export class ReviewsRepository extends BaseRepository<Review> {
  constructor() {
    super(Review);
  }

  async findByProduct(productId: string, status?: ReviewStatus) {
    const where: WhereOptions<Review> = { productId };
    if (status) {
      where.status = status;
    }
    return this.model.findAll({
      where,
      include: [{ association: 'user', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Public PDP reviews — APPROVED only, and only while the product remains customer-visible.
   */
  async findVisibleForProduct(productId: string) {
    return this.model.findAll({
      where: { productId, status: REVIEW_STATUS.APPROVED },
      include: [
        { association: 'user', attributes: ['id', 'name'] },
        {
          model: Product.scope('customerVisible'),
          as: 'product',
          required: true,
          attributes: ['id'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  /** Personal history — unscoped; customer's own reviews stay visible after catalog changes. */
  async findByUser(userId: string) {
    return this.model.findAll({
      where: { userId },
      include: [{ association: 'product', attributes: ['id', 'name', 'slug'] }],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const reviewsRepository = new ReviewsRepository();
