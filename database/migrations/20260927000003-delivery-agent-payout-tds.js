'use strict';

/**
 * TDS under s.194C on delivery-agent payouts (agents are contractors): each payout
 * records the TDS deducted, the rate applied and the net amount paid. `amount` stays the
 * gross earnings. Existing payouts had no TDS: net = gross.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('delivery_agent_payouts', 'tdsAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('delivery_agent_payouts', 'tdsRatePercent', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('delivery_agent_payouts', 'netAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE delivery_agent_payouts SET "netAmount" = amount WHERE "netAmount" IS NULL`,
    );
    await queryInterface.changeColumn('delivery_agent_payouts', 'netAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('delivery_agent_payouts', 'netAmount');
    await queryInterface.removeColumn('delivery_agent_payouts', 'tdsRatePercent');
    await queryInterface.removeColumn('delivery_agent_payouts', 'tdsAmount');
  },
};
