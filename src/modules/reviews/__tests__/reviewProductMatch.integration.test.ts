import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { reviewsService } from '../reviews.service';

describe('purchase reviews stay on the product bought (B-40)', () => {
  it('refuses an order item from one product with the id of another', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    // A delivered, not yet reviewed line, and some other product.
    const [line] = await sequelize.query<{ orderItemId: string; userId: string; productId: string }>(
      `SELECT oi.id AS "orderItemId", o."userId", pv."productId"
       FROM order_items oi
       JOIN sub_orders so ON so.id = oi."subOrderId" AND so.status = 'DELIVERED'
       JOIN orders o ON o.id = so."orderId"
       JOIN product_variants pv ON pv.id = oi."variantId"
       WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r."orderItemId" = oi.id)
       LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!line) return t.skip('no delivered, unreviewed order line');
    const [other] = await sequelize.query<{ id: string }>(
      `SELECT id FROM products WHERE id <> :id LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { id: line.productId } },
    );
    await assert.rejects(
      reviewsService.createReview(line.userId, {
        orderItemId: line.orderItemId,
        productId: other.id,
        rating: 5,
        body: 'Great product, would buy again.',
      } as never),
      (err: { statusCode?: number; validationDetails?: { fieldErrors: Record<string, string[]> } }) =>
        err.statusCode === 422 && Boolean(err.validationDetails?.fieldErrors.productId?.length),
    );
  });
});

describe('one review per product per shopper', () => {
  it('refuses a second review of a product the shopper already reviewed, even from another line', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    // A delivered, unreviewed line for a product this shopper has already reviewed elsewhere.
    const [line] = await sequelize.query<{ orderItemId: string; userId: string; productId: string }>(
      `SELECT oi.id AS "orderItemId", o."userId", pv."productId"
         FROM order_items oi
         JOIN sub_orders so ON so.id = oi."subOrderId" AND so.status = 'DELIVERED'
         JOIN orders o ON o.id = so."orderId"
         JOIN product_variants pv ON pv.id = oi."variantId"
        WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r."orderItemId" = oi.id)
          AND EXISTS (SELECT 1 FROM reviews r2 WHERE r2."userId" = o."userId" AND r2."productId" = pv."productId")
        LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!line) return t.skip('no repeat purchase of an already reviewed product');
    await assert.rejects(
      reviewsService.createReview(line.userId, {
        orderItemId: line.orderItemId,
        productId: line.productId,
        rating: 4,
        body: 'Second review of the same product, should be refused.',
      } as never),
      (err: { message?: string }) => /already reviewed this product/.test(String(err.message)),
    );
  });
});

describe('deleting your own review', () => {
  it('only the author can delete; deleting frees the order line to review again', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const [row] = await sequelize.query<{ id: string; userId: string }>(
      `SELECT id, "userId" FROM reviews WHERE "deletedAt" IS NULL LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!row) return t.skip('no review');
    // Someone else: refused, nothing changes.
    await assert.rejects(
      reviewsService.deleteOwnReview(row.id, '00000000-0000-4000-8000-000000000000'),
      (err: { message?: string }) => /your own review/.test(String(err.message)),
    );
    const [still] = await sequelize.query(`SELECT 1 FROM reviews WHERE id = :id`, {
      type: QueryTypes.SELECT,
      replacements: { id: row.id },
    });
    assert.ok(still);
  });
});
