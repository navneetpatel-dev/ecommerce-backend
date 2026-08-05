'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      subOrderId: { type: Sequelize.UUID, allowNull: false, references: { model: 'sub_orders', key: 'id' }, onDelete: 'CASCADE' },
      variantId: { type: Sequelize.UUID, allowNull: false, references: { model: 'product_variants', key: 'id' }, onDelete: 'RESTRICT' },
      productName: { type: Sequelize.STRING, allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      unitPrice: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('order_items'); },
};
