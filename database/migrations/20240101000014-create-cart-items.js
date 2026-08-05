'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cart_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      cartId: { type: Sequelize.UUID, allowNull: false, references: { model: 'carts', key: 'id' }, onDelete: 'CASCADE' },
      variantId: { type: Sequelize.UUID, allowNull: false, references: { model: 'product_variants', key: 'id' }, onDelete: 'CASCADE' },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('cart_items'); },
};
