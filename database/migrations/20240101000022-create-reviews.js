'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reviews', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      productId: { type: Sequelize.UUID, allowNull: false, references: { model: 'products', key: 'id' }, onDelete: 'CASCADE' },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      orderItemId: { type: Sequelize.UUID, unique: true, allowNull: false, references: { model: 'order_items', key: 'id' }, onDelete: 'RESTRICT' },
      rating: { type: Sequelize.SMALLINT, allowNull: false },
      title: { type: Sequelize.STRING, allowNull: true },
      body: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED'), defaultValue: 'PENDING' },
      helpfulCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      unhelpfulCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('reviews'); },
};
