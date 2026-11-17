'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'sub_orders',
        'cancellationReason',
        { type: Sequelize.STRING(500), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'sub_orders',
        'cancelledByRole',
        { type: Sequelize.STRING(32), allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('sub_orders', 'cancelledByRole', { transaction });
      await queryInterface.removeColumn('sub_orders', 'cancellationReason', { transaction });
    });
  },
};
