'use strict';

/**
 * Gap-closure for consolidated refund system:
 * - vendors.returnShippingFee (optional vendor override)
 * - orders.originalTotalAmount / razorpayAmountPaid / cashbackVendorId for stable splits & attribution
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const vendors = await queryInterface.describeTable('vendors');
    if (!vendors.returnShippingFee) {
      await queryInterface.addColumn('vendors', 'returnShippingFee', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    }

    const orders = await queryInterface.describeTable('orders');
    const addOrderCol = async (name, spec) => {
      if (!orders[name]) await queryInterface.addColumn('orders', name, spec);
    };
    await addOrderCol('originalTotalAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderCol('razorpayAmountPaid', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });
    await addOrderCol('cashbackVendorId', {
      type: Sequelize.UUID,
      allowNull: true,
    });

    // Backfill originalTotalAmount from current total for existing rows.
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET "originalTotalAmount" = "totalAmount"
      WHERE "originalTotalAmount" = 0 AND "totalAmount" > 0
    `);
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET "razorpayAmountPaid" = GREATEST(0, "totalAmount" - COALESCE("walletAmountUsed", 0))
      WHERE "razorpayAmountPaid" = 0
        AND "paymentMethod" = 'RAZORPAY'
        AND "paymentStatus" = 'PAID'
    `);
  },

  async down(queryInterface) {
    const dropCols = async (table, cols) => {
      const desc = await queryInterface.describeTable(table);
      for (const col of cols) {
        if (desc[col]) await queryInterface.removeColumn(table, col);
      }
    };
    await dropCols('orders', ['originalTotalAmount', 'razorpayAmountPaid', 'cashbackVendorId']);
    await dropCols('vendors', ['returnShippingFee']);
  },
};
