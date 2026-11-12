'use strict';

/**
 * The pre-GST price of the variant when it went into the cart (B-55), so the cart
 * can say a price changed since. Lines already in carts take today's price.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cart_items', 'unitPriceAtAdd', { type: Sequelize.DECIMAL(10, 2), allowNull: true });
    await queryInterface.sequelize.query(
      `UPDATE cart_items ci SET "unitPriceAtAdd" = pv.price
       FROM product_variants pv WHERE pv.id = ci."variantId" AND ci."unitPriceAtAdd" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cart_items', 'unitPriceAtAdd');
  },
};
