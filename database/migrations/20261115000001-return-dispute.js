'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'return_requests',
        'disputeReason',
        { type: Sequelize.STRING(255), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeDescription',
        { type: Sequelize.TEXT, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeEvidenceUrls',
        { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputedAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputedBy',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeStatus',
        { type: Sequelize.STRING(32), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeResolvedAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeResolvedBy',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'return_requests',
        'disputeResolutionNotes',
        { type: Sequelize.TEXT, allowNull: true },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('return_requests', 'disputeResolutionNotes', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeResolvedBy', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeResolvedAt', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeStatus', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputedBy', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputedAt', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeEvidenceUrls', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeDescription', { transaction });
      await queryInterface.removeColumn('return_requests', 'disputeReason', { transaction });
    });
  },
};
