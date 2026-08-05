'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('coupons', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      code: { type: Sequelize.STRING, unique: true, allowNull: false },
      type: { type: Sequelize.ENUM('PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'BOGO', 'TIERED', 'CASHBACK', 'BUNDLE'), allowNull: false },
      value: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      maxDiscountCap: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      minOrderValue: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      minQuantity: { type: Sequelize.INTEGER, allowNull: true },
      applicableScope: { type: Sequelize.JSONB, defaultValue: {} },
      excludedItems: { type: Sequelize.JSONB, defaultValue: {} },
      userRestriction: { type: Sequelize.JSONB, defaultValue: {} },
      usageLimitTotal: { type: Sequelize.INTEGER, allowNull: true },
      usageLimitPerUser: { type: Sequelize.INTEGER, defaultValue: 1 },
      usedCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      startDate: { type: Sequelize.DATE, allowNull: false },
      endDate: { type: Sequelize.DATE, allowNull: false },
      stackable: { type: Sequelize.BOOLEAN, defaultValue: false },
      priority: { type: Sequelize.INTEGER, defaultValue: 0 },
      status: { type: Sequelize.ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'), defaultValue: 'DRAFT' },
      createdById: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      vendorId: { type: Sequelize.UUID, allowNull: true, references: { model: 'vendors', key: 'id' }, onDelete: 'SET NULL' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('coupons'); },
};
