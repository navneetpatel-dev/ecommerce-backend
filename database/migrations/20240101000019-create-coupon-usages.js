'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('coupon_usages', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      couponId: { type: Sequelize.UUID, allowNull: false, references: { model: 'coupons', key: 'id' }, onDelete: 'RESTRICT' },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      orderId: { type: Sequelize.UUID, allowNull: false, references: { model: 'orders', key: 'id' }, onDelete: 'RESTRICT' },
      discountApplied: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      usedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('coupon_usages', { unique: true, fields: ['couponId', 'orderId'] });
  },
  async down(queryInterface) { await queryInterface.dropTable('coupon_usages'); },
};
