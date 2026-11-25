'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('in_app_notifications', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      broadcastId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'admin_broadcasts', key: 'id' },
        onDelete: 'SET NULL',
      },
      title: { type: Sequelize.STRING(200), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      ctaLabel: { type: Sequelize.STRING(80), allowNull: true },
      ctaUrl: { type: Sequelize.STRING(500), allowNull: true },
      category: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'BROADCAST' },
      isRead: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      readAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('in_app_notifications', ['userId', 'isRead', 'createdAt'], {
      name: 'in_app_notifications_user_read_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('in_app_notifications');
  },
};
