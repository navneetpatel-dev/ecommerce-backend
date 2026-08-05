import { BaseRepository } from '@core/repository/BaseRepository';
import { Review } from '@database/models/review.model';
import { WhereOptions } from 'sequelize';

export class ReviewsRepository extends BaseRepository<Review> {
  constructor() {
    super(Review);
  }

  async findByProduct(productId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
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

  async findByUser(userId: string) {
    return this.model.findAll({
      where: { userId },
      include: [{ association: 'product', attributes: ['id', 'name', 'slug'] }],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const reviewsRepository = new ReviewsRepository();
