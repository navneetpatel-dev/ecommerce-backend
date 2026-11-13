import { Op, fn, col, where as sqlWhere, type Order, type WhereOptions } from 'sequelize';
import { Review } from '@database/models/review.model';
import { Product } from '@database/models/product.model';
import { REVIEW_STATUS } from '@core/constants/statuses';
import type { ProductReviewsQuery } from './reviews.dto';

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export interface ProductReviewSummary {
  total: number;
  average: number;
  distribution: RatingDistribution;
  withMedia: number;
}

const SORT_ORDER: Record<ProductReviewsQuery['sort'], Order> = {
  recent: [['createdAt', 'DESC'], ['id', 'ASC']],
  helpful: [['helpfulCount', 'DESC'], ['createdAt', 'DESC'], ['id', 'ASC']],
  highest: [['rating', 'DESC'], ['createdAt', 'DESC'], ['id', 'ASC']],
  lowest: [['rating', 'ASC'], ['createdAt', 'DESC'], ['id', 'ASC']],
};

/** Shopper-visible reviews only: APPROVED, on a product still on sale. */
const visibleProduct = () => ({
  model: Product.scope('customerVisible'),
  as: 'product',
  required: true,
  attributes: [],
});

const hasMedia = () => sqlWhere(fn('jsonb_array_length', col('Review.media')), Op.gt, 0);

/** One filtered, sorted page of a product's public reviews. */
export function findVisibleReviewPage(
  productId: string,
  query: Pick<ProductReviewsQuery, 'rating' | 'withMedia' | 'sort'>,
  page: { limit: number; offset: number },
) {
  const conditions: WhereOptions[] = [{ productId, status: REVIEW_STATUS.APPROVED }];
  if (query.rating) conditions.push({ rating: query.rating });
  if (query.withMedia) conditions.push(hasMedia());

  return Review.findAndCountAll({
    where: { [Op.and]: conditions },
    include: [{ association: 'user', attributes: ['id', 'name'] }, visibleProduct()],
    order: SORT_ORDER[query.sort],
    limit: page.limit,
    offset: page.offset,
    distinct: true,
    col: 'id',
  });
}

/**
 * Star breakdown for the PDP header. Always over every public review — the
 * filters narrow the list, never the summary shoppers compare against.
 */
export async function summarizeVisibleReviews(productId: string): Promise<ProductReviewSummary> {
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  // Visibility once up front: the scope joins the vendor, which can't sit in a GROUP BY.
  const visible = await Product.scope('customerVisible').count({ where: { id: productId } });
  if (!visible) return { total: 0, average: 0, distribution, withMedia: 0 };

  const where = { productId, status: REVIEW_STATUS.APPROVED };
  const [byRating, withMedia] = await Promise.all([
    Review.findAll({
      attributes: ['rating', [fn('COUNT', col('Review.id')), 'count']],
      where,
      group: ['Review.rating'],
      raw: true,
    }) as unknown as Promise<Array<{ rating: number; count: string }>>,
    Review.count({ where: { [Op.and]: [where, hasMedia()] } }),
  ]);

  let total = 0;
  let sum = 0;
  for (const row of byRating) {
    const rating = Number(row.rating) as keyof RatingDistribution;
    const count = Number(row.count);
    if (!(rating in distribution)) continue;
    distribution[rating] = count;
    total += count;
    sum += rating * count;
  }

  return {
    total,
    average: total ? Math.round((sum / total) * 10) / 10 : 0,
    distribution,
    withMedia,
  };
}
