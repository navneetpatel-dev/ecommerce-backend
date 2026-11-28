'use strict';

/** What the customer saw the coupon take off, GST included (discountApplied excludes GST). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('coupon_usages');
    if (!table.customerDiscountApplied) {
      await queryInterface.addColumn('coupon_usages', 'customerDiscountApplied', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('coupon_usages');
    if (table.customerDiscountApplied) {
      await queryInterface.removeColumn('coupon_usages', 'customerDiscountApplied');
    }
  },
};
