'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.appliedCouponBreakdown) {
      await queryInterface.addColumn('orders', 'appliedCouponBreakdown', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (table.appliedCouponBreakdown) {
      await queryInterface.removeColumn('orders', 'appliedCouponBreakdown');
    }
  },
};
