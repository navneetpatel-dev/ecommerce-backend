'use strict';

/** Allow date-bucketed marketing referenceIds (e.g. cartId:YYYY-MM-DD). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('notification_logs', 'referenceId', {
      type: Sequelize.STRING(191),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('notification_logs', 'referenceId', {
      type: Sequelize.UUID,
      allowNull: false,
    });
  },
};
