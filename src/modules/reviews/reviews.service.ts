import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { REVIEW_STATUS, ORDER_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { reviewsRepository } from './reviews.repository';
import { Review } from '@database/models/review.model';
import { ReviewVote } from '@database/models/reviewVote.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

export class ReviewsService {
  async createReview(userId: string, data: {
    orderItemId: string;
    productId: string;
    rating: number;
    title?: string;
    body: string;
  }) {
    return sequelize.transaction(async (t) => {
      // Verify purchase
      const orderItemResult = await OrderItem.findByPk(data.orderItemId, {
        include: [{
          model: SubOrder,
          as: 'subOrder',
          include: ['order'],
        }],
        transaction: t,
      });

      if (!orderItemResult) throw new NotFoundError('OrderItem');

      // Type assertion after null check
      const orderItem = orderItemResult as OrderItem & { subOrder: SubOrder & { order: any } };

      if (orderItem.subOrder.order.userId !== userId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
      }
      if (orderItem.subOrder.status !== ORDER_STATUS.DELIVERED) {
        throw new ForbiddenError('Item not yet delivered');
      }

      // Check if already reviewed
      const existing = await Review.findOne({
        where: { orderItemId: data.orderItemId },
        transaction: t,
      });
      if (existing) {
        throw new ValidationError('Order item already reviewed');
      }

      // Create review
      const review = await Review.create({
        productId: data.productId,
        userId,
        orderItemId: data.orderItemId,
        rating: data.rating,
        title: data.title ?? null,
        body: data.body,
        status: REVIEW_STATUS.PENDING, // Set to APPROVED if auto-approve mode
        helpfulCount: 0,
        unhelpfulCount: 0,
      }, { transaction: t });

      return review;
    });
  }

  async getProductReviews(productId: string, status: typeof REVIEW_STATUS.APPROVED | 'ALL' = REVIEW_STATUS.APPROVED) {
    if (status === REVIEW_STATUS.APPROVED) {
      return reviewsRepository.findVisibleForProduct(productId);
    }
    // Admin/moderation — unscoped
    return reviewsRepository.findByProduct(productId);
  }

  /** Own reviews on account page — personal history, deliberately unscoped. */
  async getUserReviews(userId: string) {
    return reviewsRepository.findByUser(userId);
  }

  async voteReview(reviewId: string, userId: string, vote: 'HELPFUL' | 'UNHELPFUL') {
    return sequelize.transaction(async (t) => {
      const review = await Review.findByPk(reviewId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!review) throw new NotFoundError('Review');

      // Upsert vote
      const [reviewVote, created] = await ReviewVote.findOrCreate({
        where: { reviewId, userId },
        defaults: { reviewId, userId, vote },
        transaction: t,
      });

      if (!created && reviewVote.vote !== vote) {
        // Change vote
        const oldVote = reviewVote.vote;
        await reviewVote.update({ vote }, { transaction: t });

        // Update counters
        if (oldVote === 'HELPFUL') {
          await review.decrement('helpfulCount', { transaction: t });
        } else {
          await review.decrement('unhelpfulCount', { transaction: t });
        }
      }

      if (created || reviewVote.vote !== vote) {
        // Increment new vote counter
        if (vote === 'HELPFUL') {
          await review.increment('helpfulCount', { transaction: t });
        } else {
          await review.increment('unhelpfulCount', { transaction: t });
        }
      }

      return review.reload({ transaction: t });
    });
  }

  async approveReview(reviewId: string) {
    return sequelize.transaction(async (t) => {
      const review = await Review.findByPk(reviewId, { transaction: t });
      if (!review) throw new NotFoundError('Review');

      await review.update({ status: REVIEW_STATUS.APPROVED }, { transaction: t });

      // Recalculate product rating
      await this.recalculateProductRating(review.productId, t);

      return review;
    });
  }

  async rejectReview(reviewId: string) {
    return sequelize.transaction(async (t) => {
      const review = await Review.findByPk(reviewId, { transaction: t });
      if (!review) throw new NotFoundError('Review');

      await review.update({ status: REVIEW_STATUS.REJECTED }, { transaction: t });
      return review;
    });
  }

  async respondToReview(reviewId: string, vendorId: string | null, response: string) {
    const review = await Review.findByPk(reviewId, { include: [{ model: Product, as: 'product' }] });
    if (!review) throw new NotFoundError('Review');
    if (!vendorId || (review as any).product?.vendorId !== vendorId) throw new ForbiddenError('Not your product review');
    return review.update({ vendorResponse: response, vendorRespondedAt: new Date() });
  }

  async listPending(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await Review.findAndCountAll({
      where: { status: REVIEW_STATUS.PENDING },
      include: [{ model: Product, as: 'product' }],
      order: [['createdAt', 'ASC']],
      limit: query.limit,
      offset,
    });
    return {
      reviews: rows,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  private async recalculateProductRating(productId: string, transaction: any) {
    const [result] = await sequelize.query<{ avg: string; count: string }>(
      `SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as count 
       FROM reviews WHERE product_id = :productId AND status = :status`,
      {
        replacements: { productId, status: REVIEW_STATUS.APPROVED },
        type: QueryTypes.SELECT,
        transaction,
      }
    );

    await Product.update(
      { avgRating: Number(result?.avg ?? 0) },
      { where: { id: productId }, transaction }
    );
  }
}

export const reviewsService = new ReviewsService();
