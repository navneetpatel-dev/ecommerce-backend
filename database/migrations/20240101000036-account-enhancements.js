'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'avatarUrl', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'pendingEmail', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'notificationPrefs', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {
        orderUpdates: true,
        smsAlerts: false,
        shippingNotifications: true,
      },
    });

    await queryInterface.addColumn('refresh_tokens', 'userAgent', {
      type: Sequelize.STRING(512),
      allowNull: true,
    });
    await queryInterface.addColumn('refresh_tokens', 'ipAddress', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('refresh_tokens', 'lastUsedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('refresh_tokens', 'lastUsedAt');
    await queryInterface.removeColumn('refresh_tokens', 'ipAddress');
    await queryInterface.removeColumn('refresh_tokens', 'userAgent');
    await queryInterface.removeColumn('users', 'notificationPrefs');
    await queryInterface.removeColumn('users', 'pendingEmail');
    await queryInterface.removeColumn('users', 'avatarUrl');
  },
};
