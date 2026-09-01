'use strict';

/** Wallet points: point_source on ledger + wallet_recharge_orders for Razorpay top-up. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ledger = await queryInterface.describeTable('wallet_ledgers');
    if (!ledger.pointSource) {
      await queryInterface.addColumn('wallet_ledgers', 'pointSource', {
        type: Sequelize.ENUM('PURCHASED', 'PROMOTIONAL'),
        allowNull: true,
      });
      await queryInterface.sequelize.query(`
        UPDATE wallet_ledgers
        SET "pointSource" = 'PROMOTIONAL'
        WHERE type = 'CREDIT'
          AND "referenceType" IN ('CASHBACK', 'COD_REFUND', 'WALLET_REFUND', 'ORDER')
      `);
    }

    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (!names.includes('wallet_recharge_orders')) {
      await queryInterface.createTable('wallet_recharge_orders', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false },
        amountInr: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        pointsCredited: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        razorpayOrderId: { type: Sequelize.STRING(64), allowNull: true },
        razorpayPaymentId: { type: Sequelize.STRING(64), allowNull: true },
        status: {
          type: Sequelize.ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED'),
          allowNull: false,
          defaultValue: 'PENDING',
        },
        idempotencyKey: { type: Sequelize.STRING(64), allowNull: true },
        creditedLedgerId: { type: Sequelize.UUID, allowNull: true },
        paidAt: { type: Sequelize.DATE, allowNull: true },
        createdBy: { type: Sequelize.UUID, allowNull: true },
        updatedBy: { type: Sequelize.UUID, allowNull: true },
        deletedBy: { type: Sequelize.UUID, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
        deletedAt: Sequelize.DATE,
      });
      await queryInterface.addIndex('wallet_recharge_orders', ['userId']);
      await queryInterface.addIndex('wallet_recharge_orders', ['razorpayOrderId'], {
        unique: true,
        where: { razorpayOrderId: { [Sequelize.Op.ne]: null } },
        name: 'wallet_recharge_orders_razorpay_order_id_unique',
      });
      await queryInterface.addIndex(
        'wallet_recharge_orders',
        ['userId', 'idempotencyKey'],
        {
          unique: true,
          where: { idempotencyKey: { [Sequelize.Op.ne]: null } },
          name: 'wallet_recharge_orders_user_idempotency_unique',
        },
      );
      await queryInterface.addIndex('wallet_recharge_orders', ['status', 'createdAt']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_recharge_orders');
    await queryInterface.removeColumn('wallet_ledgers', 'pointSource');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_wallet_ledgers_pointSource";',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_wallet_recharge_orders_status";',
    );
  },
};
