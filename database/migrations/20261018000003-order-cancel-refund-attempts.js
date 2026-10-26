'use strict';

/**
 * A whole-order cancellation refund that fails is retried (the refund-retry job, or an
 * admin), like a part's. These track the tries, as sub_orders already does for parts.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'orders',
        'cancelRefundAttemptCount',
        { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        { transaction },
      );
      await queryInterface.addColumn(
        'orders',
        'cancelRefundLastAttemptAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('orders', 'cancelRefundLastAttemptAt', { transaction });
      await queryInterface.removeColumn('orders', 'cancelRefundAttemptCount', { transaction });
    });
  },
};
