'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('orders', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      couponId: { type: Sequelize.UUID, allowNull: true, references: { model: 'coupons', key: 'id' }, onDelete: 'SET NULL' },
      totalAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      discountTotal: { type: Sequelize.DECIMAL(10, 2), defaultValue: 0 },
      status: { type: Sequelize.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'), defaultValue: 'PENDING' },
      paymentStatus: { type: Sequelize.ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED'), defaultValue: 'PENDING' },
      shippingAddressId: { type: Sequelize.UUID, allowNull: false, references: { model: 'addresses', key: 'id' }, onDelete: 'RESTRICT' },
      razorpayOrderId: { type: Sequelize.STRING, allowNull: true },
      razorpayPaymentId: { type: Sequelize.STRING, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('orders'); },
};
