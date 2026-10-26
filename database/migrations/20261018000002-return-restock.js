'use strict';

/**
 * Returned goods go back into stock only when a vendor or admin says so (a damaged item
 * must not be resold). `restockedAt` records that it was done, so it is done once.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'return_requests',
        'restockedAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'restockedBy',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('return_requests', 'restockedBy', { transaction });
      await queryInterface.removeColumn('return_requests', 'restockedAt', { transaction });
    });
  },
};
