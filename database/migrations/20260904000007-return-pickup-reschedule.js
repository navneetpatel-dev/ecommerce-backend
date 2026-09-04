'use strict';

/** Customer repickup rescheduling after a failed attempt — mirrors shipments.preferredRedeliverySlot. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('return_requests', 'preferredRepickupSlot', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'preferredRepickupSlot');
  },
};
