'use strict';

/** Attempt tracking for part card refunds, so the refund-retry job can retry a failed one. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sub_orders', 'cancelRefundAttemptCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('sub_orders', 'cancelRefundLastAttemptAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    // A refund that already failed counts one attempt.
    await queryInterface.sequelize.query(`
      UPDATE sub_orders SET "cancelRefundAttemptCount" = 1, "cancelRefundLastAttemptAt" = "updatedAt"
      WHERE "cancelRefundStatus" = 'FAILED'
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sub_orders', 'cancelRefundLastAttemptAt');
    await queryInterface.removeColumn('sub_orders', 'cancelRefundAttemptCount');
  },
};
