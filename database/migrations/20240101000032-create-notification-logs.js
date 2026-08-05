'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notification_logs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      type: { type: Sequelize.STRING, allowNull: false },
      referenceType: { type: Sequelize.STRING, allowNull: false },
      referenceId: { type: Sequelize.UUID, allowNull: false },
      channel: { type: Sequelize.ENUM('EMAIL', 'SMS', 'PUSH'), defaultValue: 'EMAIL' },
      status: { type: Sequelize.ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED'), defaultValue: 'PENDING' },
      providerMessageId: { type: Sequelize.STRING, allowNull: true },
      error: { type: Sequelize.TEXT, allowNull: true },
      sentAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('notification_logs', { unique: true, fields: ['type', 'referenceId'], where: { status: 'SENT' } });
  },
  async down(queryInterface) { await queryInterface.dropTable('notification_logs'); },
};
