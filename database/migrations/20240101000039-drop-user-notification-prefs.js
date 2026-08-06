'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('users', 'notificationPrefs');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'notificationPrefs', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {
        orderUpdates: true,
        smsAlerts: false,
        shippingNotifications: true,
      },
    });
  },
};
