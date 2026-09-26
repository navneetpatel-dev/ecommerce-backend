'use strict';

/**
 * Repair: a return approved on an order with a cancelled or RTO'd part could store the
 * order's merchandise/tax/shipping totals over its standing parts only. Those columns
 * hold every part (the whole-cart base cashback is prorated against), so recompute them.
 * Idempotent: an order already right is rewritten with the same figures.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE orders o SET
        "merchandiseSubtotal" = t.merch / 100.0,
        "taxTotal" = t.tax / 100.0,
        "shippingTotal" = t.ship / 100.0
      FROM (
        SELECT s."orderId",
          SUM(s."subtotalPaise") AS merch,
          SUM(s."taxAmountPaise") AS tax,
          SUM(s."shippingCostPaise" - s."shippingDiscountAmountPaise") AS ship
        FROM sub_orders s
        WHERE s."deletedAt" IS NULL
        GROUP BY s."orderId"
      ) t
      WHERE t."orderId" = o.id
        AND EXISTS (
          SELECT 1 FROM sub_orders r
          WHERE r."orderId" = o.id AND r.status IN ('CANCELLED', 'RETURNED')
        )
        AND EXISTS (
          SELECT 1 FROM return_requests rr
          INNER JOIN order_items oi ON oi.id = rr."orderItemId"
          INNER JOIN sub_orders rs ON rs.id = oi."subOrderId"
          WHERE rs."orderId" = o.id
        )
    `);
  },

  async down() {
    // Data repair only.
  },
};
