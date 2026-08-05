'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      subOrderId: { type: Sequelize.UUID, unique: true, allowNull: false, references: { model: 'sub_orders', key: 'id' }, onDelete: 'CASCADE' },
      carrier: { type: Sequelize.STRING, allowNull: false },
      trackingNumber: { type: Sequelize.STRING, allowNull: false },
      trackingUrl: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.ENUM('PENDING', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'), defaultValue: 'PENDING' },
      estimatedDeliveryDate: { type: Sequelize.DATE, allowNull: true },
      shippedAt: { type: Sequelize.DATE, allowNull: true },
      deliveredAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('shipments'); },
};
