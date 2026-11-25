'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('admin_broadcasts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      actorId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      subject: { type: Sequelize.STRING(200), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      ctaLabel: { type: Sequelize.STRING(80), allowNull: true },
      ctaUrl: { type: Sequelize.STRING(500), allowNull: true },
      classification: {
        type: Sequelize.ENUM('operational', 'marketing'),
        allowNull: false,
        defaultValue: 'operational',
      },
      priority: {
        type: Sequelize.ENUM('standard', 'high'),
        allowNull: false,
        defaultValue: 'standard',
      },
      channels: { type: Sequelize.JSONB, allowNull: false, defaultValue: ['EMAIL'] },
      targetConfig: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: {
        type: Sequelize.ENUM('SCHEDULED', 'PROCESSING', 'SENT', 'CANCELLED', 'FAILED'),
        allowNull: false,
        defaultValue: 'PROCESSING',
      },
      scheduledAt: { type: Sequelize.DATE, allowNull: true },
      sentAt: { type: Sequelize.DATE, allowNull: true },
      targetedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      queuedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      error: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('admin_broadcasts', ['status', 'scheduledAt'], {
      name: 'admin_broadcasts_status_scheduled_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('admin_broadcasts');
  },
};
