'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payouts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      vendorId: { type: Sequelize.UUID, allowNull: false, references: { model: 'vendors', key: 'id' }, onDelete: 'RESTRICT' },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      periodStart: { type: Sequelize.DATE, allowNull: false },
      periodEnd: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED'), defaultValue: 'PENDING' },
      razorpayPayoutId: { type: Sequelize.STRING, allowNull: true },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('payouts'); },
};
