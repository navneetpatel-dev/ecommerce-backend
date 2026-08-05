'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_images', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      productId: { type: Sequelize.UUID, allowNull: false, references: { model: 'products', key: 'id' }, onDelete: 'CASCADE' },
      url: { type: Sequelize.STRING, allowNull: false },
      isPrimary: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('product_images'); },
};
