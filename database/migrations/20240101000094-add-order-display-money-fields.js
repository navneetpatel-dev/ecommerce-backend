'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('order_items', 'lineSubtotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('order_items', 'lineTotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('sub_orders', 'shippingCharged', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('sub_orders', 'customerTotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('orders', 'merchandiseSubtotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('orders', 'taxTotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('orders', 'shippingTotal', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('orders', 'amountDue', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      UPDATE order_items
      SET
        "lineSubtotal" = ROUND("unitPrice" * quantity, 2),
        "lineTotal" = ROUND(COALESCE("taxableAmount", 0) + COALESCE("taxAmount", 0), 2)
      WHERE "lineSubtotal" IS NULL OR "lineTotal" IS NULL;
    `);

    await queryInterface.sequelize.query(`
      UPDATE sub_orders
      SET
        "shippingCharged" = ROUND(
          COALESCE("shippingCost", 0) - COALESCE("shippingDiscountAmount", 0),
          2
        ),
        "customerTotal" = ROUND(
          COALESCE("taxableAmount", 0) + COALESCE("taxAmount", 0)
            + COALESCE("shippingCost", 0) - COALESCE("shippingDiscountAmount", 0),
          2
        )
      WHERE "shippingCharged" IS NULL OR "customerTotal" IS NULL;
    `);

    await queryInterface.sequelize.query(`
      UPDATE orders o
      SET
        "merchandiseSubtotal" = sub.merch,
        "taxTotal" = sub.tax,
        "shippingTotal" = sub.ship,
        "amountDue" = CASE
          WHEN o."paymentMethod" = 'COD' THEN o."totalAmount"
          ELSE COALESCE(NULLIF(o."razorpayAmountPaid", 0), o."totalAmount" - o."walletAmountUsed")
        END
      FROM (
        SELECT
          "orderId",
          COALESCE(SUM(subtotal), 0) AS merch,
          COALESCE(SUM("taxAmount"), 0) AS tax,
          COALESCE(SUM("shippingCost" - "shippingDiscountAmount"), 0) AS ship
        FROM sub_orders
        GROUP BY "orderId"
      ) sub
      WHERE sub."orderId" = o.id
        AND (o."merchandiseSubtotal" IS NULL OR o."taxTotal" IS NULL OR o."shippingTotal" IS NULL OR o."amountDue" IS NULL);
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'amountDue');
    await queryInterface.removeColumn('orders', 'shippingTotal');
    await queryInterface.removeColumn('orders', 'taxTotal');
    await queryInterface.removeColumn('orders', 'merchandiseSubtotal');
    await queryInterface.removeColumn('sub_orders', 'customerTotal');
    await queryInterface.removeColumn('sub_orders', 'shippingCharged');
    await queryInterface.removeColumn('order_items', 'lineTotal');
    await queryInterface.removeColumn('order_items', 'lineSubtotal');
  },
};
