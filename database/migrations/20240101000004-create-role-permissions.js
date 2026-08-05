'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('RolePermissions', {
      roleId: { type: Sequelize.UUID, allowNull: false, primaryKey: true, references: { model: 'roles', key: 'id' }, onDelete: 'CASCADE' },
      permissionId: { type: Sequelize.UUID, allowNull: false, primaryKey: true, references: { model: 'permissions', key: 'id' }, onDelete: 'CASCADE' },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('RolePermissions'); },
};
