'use strict';

/** Wallet gap closure: recharge refunds, FIFO allocations, promo expiry, GST invoice fields. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const recharge = await queryInterface.describeTable('wallet_recharge_orders');
    if (!recharge.refundStatus) {
      await queryInterface.addColumn('wallet_recharge_orders', 'refundStatus', {
        type: Sequelize.ENUM('NONE', 'PENDING', 'INITIATED', 'COMPLETED', 'FAILED'),
        allowNull: false,
        defaultValue: 'NONE',
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'razorpayRefundId', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'refundFailureReason', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'invoiceNumber', {
        type: Sequelize.STRING(32),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'taxableAmount', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'cgst', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'sgst', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'igst', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'invoiceGeneratedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_recharge_orders', 'pointsPerRupee', {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
      });
    }

    const ledger = await queryInterface.describeTable('wallet_ledgers');
    if (!ledger.expiresAt) {
      await queryInterface.addColumn('wallet_ledgers', 'expiresAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await queryInterface.addColumn('wallet_ledgers', 'pointSourceBreakdown', {
        type: Sequelize.JSONB,
        allowNull: true,
      });
    }

    const returnReq = await queryInterface.describeTable('return_requests');
    if (!returnReq.refundAttemptCount) {
      await queryInterface.addColumn('return_requests', 'refundAttemptCount', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await queryInterface.addColumn('return_requests', 'lastRefundAttemptAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await queryInterface.addColumn('return_requests', 'refundFailureReason', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }

    const orders = await queryInterface.describeTable('orders');
    if (!orders.cancelRefundStatus) {
      await queryInterface.addColumn('orders', 'cancelRefundStatus', {
        type: Sequelize.ENUM('NONE', 'PENDING', 'INITIATED', 'COMPLETED', 'FAILED'),
        allowNull: false,
        defaultValue: 'NONE',
      });
      await queryInterface.addColumn('orders', 'cancelRazorpayRefundId', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'cancelRazorpayRefundId');
    await queryInterface.removeColumn('orders', 'cancelRefundStatus');
    await queryInterface.removeColumn('return_requests', 'refundFailureReason');
    await queryInterface.removeColumn('return_requests', 'lastRefundAttemptAt');
    await queryInterface.removeColumn('return_requests', 'refundAttemptCount');
    await queryInterface.removeColumn('wallet_ledgers', 'pointSourceBreakdown');
    await queryInterface.removeColumn('wallet_ledgers', 'expiresAt');
    await queryInterface.removeColumn('wallet_recharge_orders', 'pointsPerRupee');
    await queryInterface.removeColumn('wallet_recharge_orders', 'invoiceGeneratedAt');
    await queryInterface.removeColumn('wallet_recharge_orders', 'igst');
    await queryInterface.removeColumn('wallet_recharge_orders', 'sgst');
    await queryInterface.removeColumn('wallet_recharge_orders', 'cgst');
    await queryInterface.removeColumn('wallet_recharge_orders', 'taxableAmount');
    await queryInterface.removeColumn('wallet_recharge_orders', 'invoiceNumber');
    await queryInterface.removeColumn('wallet_recharge_orders', 'refundFailureReason');
    await queryInterface.removeColumn('wallet_recharge_orders', 'razorpayRefundId');
    await queryInterface.removeColumn('wallet_recharge_orders', 'refundStatus');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_wallet_recharge_orders_refundStatus";',
    );
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_orders_cancelRefundStatus";');
  },
};
