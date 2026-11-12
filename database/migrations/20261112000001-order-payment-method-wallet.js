'use strict';

/**
 * Orders the wallet paid in full are stored as WALLET (B-39), not RAZORPAY, so the
 * shopper, reports and gateway reconciliation see how they were paid. Past ones are
 * the RAZORPAY orders where the wallet covered the total and nothing went to the gateway.
 * Runs outside a transaction: Postgres cannot use a new enum value in the transaction
 * that adds it.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TYPE "enum_orders_paymentMethod" ADD VALUE IF NOT EXISTS 'WALLET'`);
    await queryInterface.sequelize.query(
      `UPDATE orders SET "paymentMethod" = 'WALLET'
       WHERE "paymentMethod" = 'RAZORPAY' AND "walletAmountUsed" > 0
         AND "walletAmountUsed" >= "totalAmount" AND COALESCE("razorpayAmountPaid", 0) = 0`,
    );
  },

  // Postgres cannot drop an enum value; the rows go back to RAZORPAY and the value stays unused.
  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE orders SET "paymentMethod" = 'RAZORPAY' WHERE "paymentMethod" = 'WALLET'`);
  },
};
