'use strict';

/**
 * Pricing engine closure gaps:
 * - cart.couponCodes (multi-coupon: platform + vendor-scoped)
 * - integer paise columns for frozen money
 * - TCS/TDS ledgers, credit/debit notes
 * - sub_orders.roundingAdjustmentPaise
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const carts = await queryInterface.describeTable('carts');
    if (!carts.couponCodes) {
      await queryInterface.addColumn('carts', 'couponCodes', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }

    const orders = await queryInterface.describeTable('orders');
    if (!orders.appliedCouponIds) {
      await queryInterface.addColumn('orders', 'appliedCouponIds', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }

    const subOrders = await queryInterface.describeTable('sub_orders');
    if (!subOrders.roundingAdjustmentPaise) {
      await queryInterface.addColumn('sub_orders', 'roundingAdjustmentPaise', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }

    const addPaiseMirror = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        const name = `${col}Paise`;
        if (!desc[name]) {
          await queryInterface.addColumn(table, name, {
            type: Sequelize.BIGINT,
            allowNull: false,
            defaultValue: 0,
          });
        }
      }
    };

    await addPaiseMirror('order_items', [
      'discountAmount',
      'taxableAmount',
      'taxAmount',
      'commissionAmount',
      'tcsAmount',
      'netPayoutAmount',
      'unitPrice',
    ]);
    await addPaiseMirror('sub_orders', [
      'subtotal',
      'shippingCost',
      'shippingDiscountAmount',
      'taxAmount',
      'taxableAmount',
      'discountAmount',
      'commissionAmount',
      'tcsAmount',
      'netPayoutAmount',
    ]);
    await addPaiseMirror('commission_ledgers', [
      'saleAmount',
      'commissionAmount',
      'taxableAmount',
      'discountAmount',
      'taxAmount',
      'tcsAmount',
      'netPayoutAmount',
      'shippingCollected',
    ]);

    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));

    if (!names.includes('tcs_ledgers')) {
      await queryInterface.createTable('tcs_ledgers', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        orderId: { type: Sequelize.UUID, allowNull: false },
        subOrderId: { type: Sequelize.UUID, allowNull: false },
        vendorId: { type: Sequelize.UUID, allowNull: false },
        taxableAmountPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        ratePercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        tcsAmountPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
    }

    if (!names.includes('tds_ledgers')) {
      await queryInterface.createTable('tds_ledgers', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        orderId: { type: Sequelize.UUID, allowNull: false },
        subOrderId: { type: Sequelize.UUID, allowNull: false },
        vendorId: { type: Sequelize.UUID, allowNull: false },
        taxableAmountPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        ratePercent: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        tdsAmountPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
    }

    if (!names.includes('document_sequences')) {
      await queryInterface.createTable('document_sequences', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        kind: { type: Sequelize.STRING(32), allowNull: false, unique: true },
        nextValue: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
        prefix: { type: Sequelize.STRING(16), allowNull: false },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
      });
      const now = new Date();
      await queryInterface.bulkInsert('document_sequences', [
        {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'CREDIT_NOTE',
          nextValue: 1,
          prefix: 'CN',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'DEBIT_NOTE',
          nextValue: 1,
          prefix: 'DN',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    if (!names.includes('credit_notes')) {
      await queryInterface.createTable('credit_notes', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        number: { type: Sequelize.STRING(32), allowNull: false, unique: true },
        returnRequestId: { type: Sequelize.UUID, allowNull: false },
        orderId: { type: Sequelize.UUID, allowNull: false },
        orderItemId: { type: Sequelize.UUID, allowNull: false },
        userId: { type: Sequelize.UUID, allowNull: false },
        merchandisePaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        taxPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        totalPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        taxBreakdown: { type: Sequelize.JSONB, allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
    }

    if (!names.includes('debit_notes')) {
      await queryInterface.createTable('debit_notes', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        number: { type: Sequelize.STRING(32), allowNull: false, unique: true },
        returnRequestId: { type: Sequelize.UUID, allowNull: false },
        orderId: { type: Sequelize.UUID, allowNull: false },
        orderItemId: { type: Sequelize.UUID, allowNull: false },
        vendorId: { type: Sequelize.UUID, allowNull: false },
        commissionPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        tcsPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        netClawbackPaise: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
    }
  },

  async down(queryInterface) {
    const dropTable = async (name) => {
      const tables = await queryInterface.showAllTables();
      const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
      if (names.includes(name)) await queryInterface.dropTable(name);
    };
    await dropTable('debit_notes');
    await dropTable('credit_notes');
    await dropTable('document_sequences');
    await dropTable('tds_ledgers');
    await dropTable('tcs_ledgers');

    const dropCols = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (desc[col]) await queryInterface.removeColumn(table, col);
      }
    };
    await dropCols('commission_ledgers', [
      'saleAmountPaise',
      'commissionAmountPaise',
      'taxableAmountPaise',
      'discountAmountPaise',
      'taxAmountPaise',
      'tcsAmountPaise',
      'netPayoutAmountPaise',
      'shippingCollectedPaise',
    ]);
    await dropCols('sub_orders', [
      'roundingAdjustmentPaise',
      'subtotalPaise',
      'shippingCostPaise',
      'shippingDiscountAmountPaise',
      'taxAmountPaise',
      'taxableAmountPaise',
      'discountAmountPaise',
      'commissionAmountPaise',
      'tcsAmountPaise',
      'netPayoutAmountPaise',
    ]);
    await dropCols('order_items', [
      'discountAmountPaise',
      'taxableAmountPaise',
      'taxAmountPaise',
      'commissionAmountPaise',
      'tcsAmountPaise',
      'netPayoutAmountPaise',
      'unitPricePaise',
    ]);
    await dropCols('carts', ['couponCodes']);
    await dropCols('orders', ['appliedCouponIds']);
  },
};
