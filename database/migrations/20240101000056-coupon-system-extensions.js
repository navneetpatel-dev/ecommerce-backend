'use strict';

/** Coupon system: discountBearer, CouponBatch, cart.couponCode, subOrder.discountAmount, wallet_ledgers. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const coupons = await queryInterface.describeTable('coupons');

    if (!coupons.discountBearer) {
      await queryInterface.addColumn('coupons', 'discountBearer', {
        type: Sequelize.ENUM('PLATFORM', 'VENDOR'),
        allowNull: false,
        defaultValue: 'PLATFORM',
      });
    }

    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (!tableNames.includes('coupon_batches')) {
      await queryInterface.createTable('coupon_batches', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        name: { type: Sequelize.STRING, allowNull: false },
        templateCouponConfig: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        generatedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        createdById: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'RESTRICT',
        },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
    }

    if (!coupons.batchId) {
      await queryInterface.addColumn('coupons', 'batchId', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'coupon_batches', key: 'id' },
        onDelete: 'SET NULL',
      });
    }

    const carts = await queryInterface.describeTable('carts');
    if (!carts.couponCode) {
      await queryInterface.addColumn('carts', 'couponCode', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    const subOrders = await queryInterface.describeTable('sub_orders');
    if (!subOrders.discountAmount) {
      await queryInterface.addColumn('sub_orders', 'discountAmount', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }

    const allTables = await queryInterface.showAllTables();
    const names = allTables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));
    if (!names.includes('wallet_ledgers')) {
      await queryInterface.createTable('wallet_ledgers', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'RESTRICT',
        },
        type: { type: Sequelize.ENUM('CREDIT', 'DEBIT'), allowNull: false },
        amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
        balanceAfter: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
        referenceType: { type: Sequelize.STRING, allowNull: false },
        referenceId: { type: Sequelize.UUID, allowNull: false },
        description: { type: Sequelize.STRING, allowNull: false },
        expiresAt: { type: Sequelize.DATE, allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
    }
  },

  async down(queryInterface) {
    const allTables = await queryInterface.showAllTables();
    const names = allTables.map((t) => (typeof t === 'string' ? t : t.tableName || t.name));

    if (names.includes('wallet_ledgers')) {
      await queryInterface.dropTable('wallet_ledgers');
      try {
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_wallet_ledgers_type";');
      } catch {
        // ignore
      }
    }

    const subOrders = await queryInterface.describeTable('sub_orders');
    if (subOrders.discountAmount) {
      await queryInterface.removeColumn('sub_orders', 'discountAmount');
    }

    const carts = await queryInterface.describeTable('carts');
    if (carts.couponCode) {
      await queryInterface.removeColumn('carts', 'couponCode');
    }

    const coupons = await queryInterface.describeTable('coupons');
    if (coupons.batchId) {
      await queryInterface.removeColumn('coupons', 'batchId');
    }

    if (names.includes('coupon_batches')) {
      await queryInterface.dropTable('coupon_batches');
    }

    if (coupons.discountBearer) {
      await queryInterface.removeColumn('coupons', 'discountBearer');
      try {
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_coupons_discountBearer";');
      } catch {
        // ignore
      }
    }
  },
};
