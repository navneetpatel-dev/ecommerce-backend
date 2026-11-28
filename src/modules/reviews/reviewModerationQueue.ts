import { Op } from 'sequelize';
import { REVIEW_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { Product } from '@database/models/product.model';
import { Review } from '@database/models/review.model';
import { User } from '@database/models/user.model';
import { serializePendingReview } from './reviewRevisions';

/** New reviews, edits of approved ones, and reviews flagged by merchants or users, oldest first. */
export async function listPendingReviews(query: { page: number; limit: number }) {
  const { rows, count } = await Review.findAndCountAll({
    where: {
      [Op.or]: [
        { status: REVIEW_STATUS.PENDING },
        { pendingRevision: { [Op.ne]: null } },
        { flaggedReason: { [Op.ne]: null } },
      ],
    },
    include: [
      { model: Product, as: 'product', attributes: ['id', 'name'] },
      { model: User, as: 'user', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'ASC']],
    limit: query.limit,
    offset: paginationOffset(query.page, query.limit),
    distinct: true,
    col: 'id',
  });
  return {
    reviews: rows.map((row) => serializePendingReview(row)),
    pagination: buildPaginationMeta(count, query.page, query.limit),
  };
}
