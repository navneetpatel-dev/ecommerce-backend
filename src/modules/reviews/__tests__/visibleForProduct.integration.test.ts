import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { Product, sequelize } from '@database/models';
import { reviewsRepository } from '../reviews.repository';

describe('approved reviews for a product page', () => {
  it('loads through the customerVisible product scope under the "product" alias', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    // A visible product that has approved reviews, if the database holds one.
    const [row] = await sequelize.query<{ productId: string; n: number }>(
      `SELECT r."productId", count(*)::int AS n FROM reviews r
       WHERE r.status = 'APPROVED' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      { type: QueryTypes.SELECT },
    );
    const reviews = await reviewsRepository.findVisibleForProduct(row?.productId ?? '00000000-0000-0000-0000-000000000000');
    if (!row) return;
    const visible = await Product.scope('customerVisible').findByPk(row.productId);
    assert.equal(reviews.length, visible ? row.n : 0);
  });

  it('keeps the category rule when Product is the root model', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const hidden = await Product.scope('customerVisible').count({
      where: sequelize.literal(`"Product"."categoryId" NOT IN (SELECT id FROM categories WHERE status = 'ACTIVE' AND "deletedAt" IS NULL)`),
    });
    assert.equal(hidden, 0);
  });
});
