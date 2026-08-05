'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipping_rates', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      zoneId: { type: Sequelize.UUID, allowNull: false, references: { model: 'shipping_zones', key: 'id' }, onDelete: 'CASCADE' },
      vendorId: { type: Sequelize.UUID, allowNull: true, references: { model: 'vendors', key: 'id' }, onDelete: 'CASCADE' },
      method: { type: Sequelize.ENUM('STANDARD', 'EXPRESS'), defaultValue: 'STANDARD' },
      minWeightGrams: { type: Sequelize.INTEGER, defaultValue: 0 },
      maxWeightGrams: { type: Sequelize.INTEGER, allowNull: false },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      estimatedDays: { type: Sequelize.INTEGER, allowNull: false },
      freeShippingThreshold: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('shipping_rates'); },
};
