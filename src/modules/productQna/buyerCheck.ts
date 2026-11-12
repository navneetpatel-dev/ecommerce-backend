import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { ORDER_STATUS } from '@core/constants/statuses';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { Product } from '@database/models/product.model';

export const BUYERS_ONLY_ANSWER = 'Only shoppers who have received this product can answer questions about it.';

/** True when the shopper has had this product delivered (a later return still counts). */
export async function hasReceivedProduct(userId: string, productId: string, transaction?: Transaction): Promise<boolean> {
  const rows = await sequelize.query<{ found: number }>(
    `SELECT 1 AS found FROM order_items oi
       JOIN product_variants pv ON pv.id = oi."variantId"
       JOIN sub_orders so ON so.id = oi."subOrderId" AND so."deletedAt" IS NULL
       JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
      WHERE o."userId" = :userId AND pv."productId" = :productId
        AND so.status IN (:received) AND oi."deletedAt" IS NULL
      LIMIT 1`,
    {
      replacements: { userId, productId, received: [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED] },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return rows.length > 0;
}

/** C-01: a shopper's answer must come from someone who bought the product. */
export async function assertBuyerMayAnswer(userId: string, productId: string, transaction?: Transaction): Promise<void> {
  if (!(await hasReceivedProduct(userId, productId, transaction))) throw new ForbiddenError(BUYERS_ONLY_ANSWER);
}

/** The product's own seller, or a shopper who has received it (C-01). */
export async function canAnswerForProduct(userId: string, vendorId: string | null, productId: string): Promise<boolean> {
  if (vendorId) {
    const product = await Product.findByPk(productId, { attributes: ['vendorId'] });
    if (product?.vendorId === vendorId) return true;
  }
  return hasReceivedProduct(userId, productId);
}
