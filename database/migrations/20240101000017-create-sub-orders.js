'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sub_orders', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      orderId: { type: Sequelize.UUID, allowNull: false, references: { model: 'orders', key: 'id' }, onDelete: 'CASCADE' },
      vendorId: { type: Sequelize.UUID, allowNull: false, references: { model: 'vendors', key: 'id' }, onDelete: 'RESTRICT' },
      status: { type: Sequelize.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'), defaultValue: 'PENDING' },
      subtotal: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      commissionAmount: { type: Sequelize.DECIMAL(10, 2), defaultValue: 0 },
      trackingId: { type: Sequelize.STRING, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('sub_orders'); },
};
