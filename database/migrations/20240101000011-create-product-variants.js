'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_variants', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      productId: { type: Sequelize.UUID, allowNull: false, references: { model: 'products', key: 'id' }, onDelete: 'CASCADE' },
      sku: { type: Sequelize.STRING, unique: true, allowNull: false },
      attributes: { type: Sequelize.JSONB, defaultValue: {} },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      stock: { type: Sequelize.INTEGER, defaultValue: 0 },
      lowStockAt: { type: Sequelize.INTEGER, defaultValue: 5 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('product_variants'); },
};
