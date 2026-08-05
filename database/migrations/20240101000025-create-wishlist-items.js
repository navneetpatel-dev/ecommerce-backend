'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wishlist_items', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      wishlistId: { type: Sequelize.UUID, allowNull: false, references: { model: 'wishlists', key: 'id' }, onDelete: 'CASCADE' },
      productId: { type: Sequelize.UUID, allowNull: false, references: { model: 'products', key: 'id' }, onDelete: 'CASCADE' },
      priceAtAdd: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('wishlist_items', { unique: true, fields: ['wishlistId', 'productId'] });
  },
  async down(queryInterface) { await queryInterface.dropTable('wishlist_items'); },
};
