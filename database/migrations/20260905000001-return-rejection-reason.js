'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('return_requests');
    if (!table.rejectionReason) {
      await queryInterface.addColumn('return_requests', 'rejectionReason', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('return_requests');
    if (table.rejectionReason) {
      await queryInterface.removeColumn('return_requests', 'rejectionReason');
    }
  },
};
