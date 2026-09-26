'use strict';

/**
 * A wallet top-up is prepaid store credit, not a supply, so it carries no GST: ₹100
 * paid is 100 points, and GST is charged on the goods bought with them at checkout.
 * Drop the GST split the recharge receipt used to store (it showed ₹15.25 of "GST"
 * inside a ₹100 top-up, taxing that money twice).
 */

const GST_COLUMNS = ['taxableAmount', 'cgst', 'sgst', 'igst'];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of GST_COLUMNS) {
        await queryInterface.removeColumn('wallet_recharge_orders', column, { transaction });
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of GST_COLUMNS) {
        await queryInterface.addColumn(
          'wallet_recharge_orders',
          column,
          { type: Sequelize.DECIMAL(12, 2), allowNull: true },
          { transaction },
        );
      }
    });
  },
};
