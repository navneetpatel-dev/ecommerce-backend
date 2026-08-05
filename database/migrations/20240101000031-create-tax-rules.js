'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tax_rules', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      categoryId: { type: Sequelize.UUID, allowNull: true, references: { model: 'categories', key: 'id' }, onDelete: 'SET NULL' },
      hsnCode: { type: Sequelize.STRING, allowNull: true },
      gstPercentage: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('tax_rules'); },
};
