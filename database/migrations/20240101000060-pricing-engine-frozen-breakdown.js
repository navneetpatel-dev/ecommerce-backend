'use strict';

/** Freeze PricingEngine snapshots on order_items / sub_orders / commission_ledgers / returns. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const orderItems = await queryInterface.describeTable('order_items');
    const addOrderItem = async (name, def) => {
      if (!orderItems[name]) await queryInterface.addColumn('order_items', name, def);
    };
    await addOrderItem('discountAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderItem('taxableAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderItem('taxAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderItem('taxBreakdown', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await addOrderItem('commissionAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderItem('tcsAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderItem('netPayoutAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    const subOrders = await queryInterface.describeTable('sub_orders');
    const addSub = async (name, def) => {
      if (!subOrders[name]) await queryInterface.addColumn('sub_orders', name, def);
    };
    await addSub('taxableAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addSub('taxBreakdown', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await addSub('tcsAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addSub('netPayoutAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addSub('shippingDiscountAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    const ledgers = await queryInterface.describeTable('commission_ledgers');
    const addLedger = async (name, def) => {
      if (!ledgers[name]) await queryInterface.addColumn('commission_ledgers', name, def);
    };
    await addLedger('taxableAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addLedger('discountAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addLedger('discountBearer', {
      type: Sequelize.ENUM('PLATFORM', 'VENDOR'),
      allowNull: true,
    });
    await addLedger('taxAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addLedger('tcsAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addLedger('netPayoutAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addLedger('shippingCollected', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    const returns = await queryInterface.describeTable('return_requests');
    const addReturn = async (name, def) => {
      if (!returns[name]) await queryInterface.addColumn('return_requests', name, def);
    };
    await addReturn('refundTaxAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await addReturn('refundCommissionAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await addReturn('refundTcsAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await addReturn('refundNetClawback', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const dropCols = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (desc[col]) await queryInterface.removeColumn(table, col);
      }
    };

    await dropCols('return_requests', [
      'refundTaxAmount',
      'refundCommissionAmount',
      'refundTcsAmount',
      'refundNetClawback',
    ]);
    await dropCols('commission_ledgers', [
      'taxableAmount',
      'discountAmount',
      'discountBearer',
      'taxAmount',
      'tcsAmount',
      'netPayoutAmount',
      'shippingCollected',
    ]);
    await dropCols('sub_orders', [
      'taxableAmount',
      'taxBreakdown',
      'tcsAmount',
      'netPayoutAmount',
      'shippingDiscountAmount',
    ]);
    await dropCols('order_items', [
      'discountAmount',
      'taxableAmount',
      'taxAmount',
      'taxBreakdown',
      'commissionAmount',
      'tcsAmount',
      'netPayoutAmount',
    ]);

    try {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_commission_ledgers_discountBearer";',
      );
    } catch {
      /* ignore */
    }
  },
};
