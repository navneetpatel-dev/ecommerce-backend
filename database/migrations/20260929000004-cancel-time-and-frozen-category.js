'use strict';

/**
 * - sub_orders.cancelledAt: when a part was cancelled. The cancellations report used
 *   `updatedAt`, which moves on every later update. Backfilled from `updatedAt` for parts
 *   already cancelled (the best record there is).
 * - order_items.categoryId: the product's category when it was sold, so category reports
 *   do not move when a product is recategorised later. Backfilled from the product's
 *   current category.
 * - gift_cards.paidAt: when the card's payment went through, so "sold" counts cards by
 *   the day they were paid for, not the day checkout started. Backfilled from
 *   `createdAt` for cards already paid (payment follows checkout within minutes).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sub_orders', 'cancelledAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE sub_orders SET "cancelledAt" = "updatedAt" WHERE status = 'CANCELLED' AND "cancelledAt" IS NULL`,
    );
    await queryInterface.addColumn('order_items', 'categoryId', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE order_items oi
       SET "categoryId" = p."categoryId"
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv."productId"
       WHERE pv.id = oi."variantId" AND oi."categoryId" IS NULL`,
    );
    await queryInterface.addColumn('gift_cards', 'paidAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE gift_cards SET "paidAt" = "createdAt"
       WHERE status IN ('ACTIVE', 'REDEEMED', 'EXPIRED') AND "paidAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('gift_cards', 'paidAt');
    await queryInterface.removeColumn('order_items', 'categoryId');
    await queryInterface.removeColumn('sub_orders', 'cancelledAt');
  },
};
