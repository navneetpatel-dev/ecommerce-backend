'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      actorId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      action: { type: Sequelize.STRING, allowNull: false },
      entityType: { type: Sequelize.STRING, allowNull: false },
      entityId: { type: Sequelize.UUID, allowNull: false },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('audit_logs'); },
};
