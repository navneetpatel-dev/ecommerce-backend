'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('commission_ledgers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      vendorId: { type: Sequelize.UUID, allowNull: false, references: { model: 'vendors', key: 'id' }, onDelete: 'RESTRICT' },
      subOrderId: { type: Sequelize.UUID, allowNull: false, references: { model: 'sub_orders', key: 'id' }, onDelete: 'CASCADE' },
      saleAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      commissionRate: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
      commissionAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: { type: Sequelize.ENUM('PENDING', 'SETTLED', 'CLAWED_BACK'), defaultValue: 'PENDING' },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('commission_ledgers'); },
};
