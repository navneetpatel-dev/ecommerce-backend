'use strict';

/**
 * Consolidated refund + wallet system:
 * - wallet_ledgers / wallet_write_offs
 * - orders: walletAmountUsed, pendingCashbackAmount, cashbackCreditedAt, paymentMethod
 * - return_requests: refundMethod, refundStatus, receivedAt, razorpayRefundId
 * - platform settings: returnShippingFee
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('wallet_ledgers')) {
      await queryInterface.createTable('wallet_ledgers', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false },
        type: { type: Sequelize.ENUM('CREDIT', 'DEBIT'), allowNull: false },
        amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        balanceAfter: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        referenceType: { type: Sequelize.STRING(64), allowNull: false },
        referenceId: { type: Sequelize.STRING(64), allowNull: false },
        description: { type: Sequelize.STRING(255), allowNull: false },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
      await queryInterface.addIndex('wallet_ledgers', ['userId']);
      await queryInterface.addIndex('wallet_ledgers', ['referenceType', 'referenceId']);
    }

    if (!names.includes('wallet_write_offs')) {
      await queryInterface.createTable('wallet_write_offs', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false },
        originalClawbackAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        recoveredAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        writtenOffAmount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        referenceType: { type: Sequelize.STRING(64), allowNull: false },
        referenceId: { type: Sequelize.STRING(64), allowNull: false },
        bornBy: { type: Sequelize.ENUM('PLATFORM', 'VENDOR'), allowNull: false },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
      await queryInterface.addIndex('wallet_write_offs', ['userId']);
      await queryInterface.addIndex('wallet_write_offs', ['bornBy']);
    }

    const orders = await queryInterface.describeTable('orders');
    const addOrderCol = async (name, spec) => {
      if (!orders[name]) await queryInterface.addColumn('orders', name, spec);
    };
    await addOrderCol('walletAmountUsed', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderCol('pendingCashbackAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderCol('cashbackCreditedAt', { type: Sequelize.DATE, allowNull: true });
    await addOrderCol('paymentMethod', {
      type: Sequelize.ENUM('RAZORPAY', 'COD'),
      allowNull: true,
    });
    await addOrderCol('cashbackDiscountBearer', {
      type: Sequelize.ENUM('PLATFORM', 'VENDOR'),
      allowNull: true,
    });

    const returns = await queryInterface.describeTable('return_requests');
    const addReturnCol = async (name, spec) => {
      if (!returns[name]) await queryInterface.addColumn('return_requests', name, spec);
    };
    await addReturnCol('refundMethod', {
      type: Sequelize.ENUM('RAZORPAY', 'WALLET_CREDIT'),
      allowNull: true,
    });
    await addReturnCol('refundStatus', {
      type: Sequelize.ENUM('NONE', 'PENDING', 'INITIATED', 'COMPLETED', 'FAILED'),
      allowNull: false,
      defaultValue: 'NONE',
    });
    await addReturnCol('receivedAt', { type: Sequelize.DATE, allowNull: true });
    await addReturnCol('razorpayRefundId', { type: Sequelize.STRING, allowNull: true });
    await addReturnCol('walletRefundAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addReturnCol('razorpayRefundAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addReturnCol('shippingRefundAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addReturnCol('returnShippingFeeAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    const commission = await queryInterface.describeTable('commission_ledgers');
    if (!commission.referenceType) {
      await queryInterface.addColumn('commission_ledgers', 'referenceType', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }

    // Seed platform returnShippingFee into platform settings JSON if missing.
    const [settingsRows] = await queryInterface.sequelize.query(
      `SELECT id, value FROM platform_settings WHERE key = 'platform' LIMIT 1`,
    );
    if (Array.isArray(settingsRows) && settingsRows.length > 0) {
      const row = settingsRows[0];
      const value =
        typeof row.value === 'string' ? JSON.parse(row.value) : row.value || {};
      if (value.returnShippingFee == null) {
        value.returnShippingFee = 0;
        await queryInterface.sequelize.query(
          `UPDATE platform_settings SET value = :value, "updatedAt" = NOW() WHERE key = 'platform'`,
          { replacements: { value: JSON.stringify(value) } },
        );
      }
    }
  },

  async down(queryInterface) {
    const dropCols = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (desc[col]) await queryInterface.removeColumn(table, col);
      }
    };
    await dropCols('return_requests', [
      'refundMethod',
      'refundStatus',
      'receivedAt',
      'razorpayRefundId',
      'walletRefundAmount',
      'razorpayRefundAmount',
      'shippingRefundAmount',
      'returnShippingFeeAmount',
    ]);
    await dropCols('orders', [
      'walletAmountUsed',
      'pendingCashbackAmount',
      'cashbackCreditedAt',
      'paymentMethod',
      'cashbackDiscountBearer',
    ]);
    await dropCols('commission_ledgers', ['referenceType']);
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('wallet_write_offs')) await queryInterface.dropTable('wallet_write_offs');
    if (names.includes('wallet_ledgers')) await queryInterface.dropTable('wallet_ledgers');
    try {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_wallet_ledgers_type";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_wallet_write_offs_bornBy";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_return_requests_refundMethod";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_return_requests_refundStatus";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_orders_paymentMethod";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_orders_cashbackDiscountBearer";');
    } catch {
      // ignore
    }
  },
};
