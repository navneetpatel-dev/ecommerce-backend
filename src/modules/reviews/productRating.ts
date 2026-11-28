import { QueryTypes, type Transaction } from 'sequelize';
import { REVIEW_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { Product } from '@database/models/product.model';

/** A product's average rating is the average of its approved reviews. */
export async function recalculateProductRating(productId: string, transaction: Transaction): Promise<void> {
  const [result] = await sequelize.query<{ avg: string; count: string }>(
    `SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as count
     FROM reviews WHERE "productId" = :productId AND status = :status AND "deletedAt" IS NULL`,
    {
      replacements: { productId, status: REVIEW_STATUS.APPROVED },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  await Product.update({ avgRating: Number(result?.avg ?? 0) }, { where: { id: productId }, transaction });
}
