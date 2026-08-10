'use strict';

/** Adds return-request photo URL array for Phase-2 attach after standalone uploads. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('return_requests', 'photoUrls', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'photoUrls');
  },
};
