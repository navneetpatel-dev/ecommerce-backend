import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_STATUS, PRODUCT_STATUS } from '@core/constants/statuses';

/**
 * Delivered lines of this shopper for products they have not reviewed yet.
 * One review per product per shopper: buying it again does not ask twice.
 */
const AWAITING_REVIEW_FROM = `
  FROM order_items oi
  JOIN sub_orders so ON so.id = oi."subOrderId" AND so.status = :delivered AND so."deletedAt" IS NULL
  JOIN orders o ON o.id = so."orderId" AND o."userId" = :userId AND o."deletedAt" IS NULL
  JOIN product_variants pv ON pv.id = oi."variantId"
  JOIN products p ON p.id = pv."productId" AND p."deletedAt" IS NULL AND p.status = :live
 WHERE oi."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM reviews r
      WHERE r."userId" = :userId AND r."productId" = pv."productId" AND r."deletedAt" IS NULL)`;

const base = (userId: string) => ({ userId, delivered: ORDER_STATUS.DELIVERED, live: PRODUCT_STATUS.LIVE });

/** The PDP "Write a review" line for this product, or null. */
export async function findReviewableOrderItem(userId: string, productId: string): Promise<string | null> {
  const [row] = await sequelize.query<{ id: string }>(
    `SELECT oi.id ${AWAITING_REVIEW_FROM} AND pv."productId" = :productId
      ORDER BY so."updatedAt" DESC, oi.id LIMIT 1`,
    { replacements: { ...base(userId), productId }, type: QueryTypes.SELECT },
  );
  return row?.id ?? null;
}

export interface AwaitingReviewProduct {
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  orderItemId: string;
  orderId: string;
  deliveredAt: Date;
}

/** "Waiting for your review": one row per product (latest delivery), newest first, paged. */
export async function findProductsAwaitingReview(userId: string, limit: number, offset: number) {
  const replacements = { ...base(userId), limit, offset };
  const [rows, [countRow]] = await Promise.all([
    sequelize.query<AwaitingReviewProduct>(
      `SELECT * FROM (
         SELECT DISTINCT ON (pv."productId")
                pv."productId", p.name AS "productName", p.slug AS "productSlug",
                oi.id AS "orderItemId", so."orderId", so."updatedAt" AS "deliveredAt",
                (SELECT pi.url FROM product_images pi
                  WHERE pi."productId" = pv."productId" AND pi."deletedAt" IS NULL
                  ORDER BY pi."isPrimary" DESC, pi."createdAt" LIMIT 1) AS "imageUrl"
         ${AWAITING_REVIEW_FROM}
          ORDER BY pv."productId", so."updatedAt" DESC, oi.id
       ) latest
       ORDER BY "deliveredAt" DESC, "productId"
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ count: number }>(
      `SELECT COUNT(DISTINCT pv."productId")::int AS count ${AWAITING_REVIEW_FROM}`,
      { replacements, type: QueryTypes.SELECT },
    ),
  ]);
  return { rows, count: countRow?.count ?? 0 };
}
