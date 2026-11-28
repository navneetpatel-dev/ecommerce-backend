'use strict';

/** One entry per cashback coupon on the order: its own payer, amount and eligible lines. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.cashbackBreakdown) {
      await queryInterface.addColumn('orders', 'cashbackBreakdown', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (table.cashbackBreakdown) await queryInterface.removeColumn('orders', 'cashbackBreakdown');
  },
};
