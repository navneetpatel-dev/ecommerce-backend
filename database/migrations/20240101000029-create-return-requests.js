'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('return_requests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      subOrderId: { type: Sequelize.UUID, allowNull: false, references: { model: 'sub_orders', key: 'id' }, onDelete: 'CASCADE' },
      orderItemId: { type: Sequelize.UUID, allowNull: false, references: { model: 'order_items', key: 'id' }, onDelete: 'CASCADE' },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      reason: { type: Sequelize.TEXT, allowNull: false },
      reasonCode: { type: Sequelize.ENUM('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'OTHER'), allowNull: false },
      status: { type: Sequelize.ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'CLOSED'), defaultValue: 'REQUESTED' },
      refundAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      resolvedById: { type: Sequelize.UUID, allowNull: true },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('return_requests'); },
};
