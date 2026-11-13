import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';

export interface OrderItemReviewState {
  /** The product the line was bought as (for posting a review against it). */
  productId: string | null;
  /** The shopper's review of this line, in any moderation state. */
  review: { id: string; rating: number; status: string } | null;
  /** The buyer already reviewed this product on another line (one review per product). */
  productReviewed: boolean;
}

/**
 * One query for every line of an order: which product it was and whether it
 * already has a review. Reviews are one per order line (unique orderItemId).
 */
export async function orderItemReviewStates(itemIds: string[]): Promise<Map<string, OrderItemReviewState>> {
  const states = new Map<string, OrderItemReviewState>();
  if (!itemIds.length) return states;
  const rows = await sequelize.query<{
    id: string;
    productId: string | null;
    reviewId: string | null;
    rating: number | null;
    status: string | null;
    productReviewed: boolean;
  }>(
    `SELECT oi.id, pv."productId", r.id AS "reviewId", r.rating, r.status,
            EXISTS (
              SELECT 1 FROM reviews r2
               WHERE r2."userId" = o."userId" AND r2."productId" = pv."productId" AND r2."deletedAt" IS NULL
            ) AS "productReviewed"
       FROM order_items oi
       JOIN sub_orders so ON so.id = oi."subOrderId"
       JOIN orders o ON o.id = so."orderId"
       LEFT JOIN product_variants pv ON pv.id = oi."variantId"
       LEFT JOIN reviews r ON r."orderItemId" = oi.id AND r."deletedAt" IS NULL
      WHERE oi.id IN (:ids)`,
    { replacements: { ids: itemIds }, type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    states.set(row.id, {
      productId: row.productId,
      review: row.reviewId ? { id: row.reviewId, rating: Number(row.rating), status: String(row.status) } : null,
      productReviewed: Boolean(row.productReviewed),
    });
  }
  return states;
}

/** Same rule the review endpoint enforces: delivered, a known product, not yet reviewed. */
export function canReviewLine(subOrderStatus: unknown, state: OrderItemReviewState | undefined): boolean {
  return (
    subOrderStatus === ORDER_STATUS.DELIVERED && Boolean(state?.productId) && !state?.review && !state?.productReviewed
  );
}
