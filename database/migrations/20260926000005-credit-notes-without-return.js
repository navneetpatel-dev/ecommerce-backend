'use strict';

/**
 * A credit note can reverse an invoice without a customer return: a part that came back
 * undelivered (RTO) credits every line of its tax invoice, and the gift-wrap platform
 * invoice has no order line. `returnRequestId` and `orderItemId` become optional.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.changeColumn(
        'credit_notes',
        'returnRequestId',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
      await queryInterface.changeColumn(
        'credit_notes',
        'orderItemId',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Notes without a return (RTO) cannot survive the old NOT NULL columns.
      await queryInterface.sequelize.query(
        `DELETE FROM credit_notes WHERE "returnRequestId" IS NULL OR "orderItemId" IS NULL`,
        { transaction },
      );
      await queryInterface.changeColumn(
        'credit_notes',
        'returnRequestId',
        { type: Sequelize.UUID, allowNull: false },
        { transaction },
      );
      await queryInterface.changeColumn(
        'credit_notes',
        'orderItemId',
        { type: Sequelize.UUID, allowNull: false },
        { transaction },
      );
    });
  },
};
