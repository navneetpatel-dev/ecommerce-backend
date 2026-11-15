'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'reviews',
        'flaggedReason',
        { type: Sequelize.STRING(500), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'reviews',
        'flaggedAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'reviews',
        'flaggedBy',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('reviews', 'flaggedBy', { transaction });
      await queryInterface.removeColumn('reviews', 'flaggedAt', { transaction });
      await queryInterface.removeColumn('reviews', 'flaggedReason', { transaction });
    });
  },
};
