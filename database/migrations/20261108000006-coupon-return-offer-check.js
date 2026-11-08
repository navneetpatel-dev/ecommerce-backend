'use strict';

/**
 * couponLineBreakdown: each conditional coupon's terms (BOGO, bundle, tiers, minimums) and
 * its discount per line at placement, so a return can re-check the offer on what's kept.
 * offerAdjustmentPaise: what a return held back because the kept items no longer qualify.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const orders = await queryInterface.describeTable('orders');
    if (!orders.couponLineBreakdown) {
      await queryInterface.addColumn('orders', 'couponLineBreakdown', { type: Sequelize.JSONB, allowNull: true });
    }
    const returns = await queryInterface.describeTable('return_requests');
    if (!returns.offerAdjustmentPaise) {
      await queryInterface.addColumn('return_requests', 'offerAdjustmentPaise', { type: Sequelize.BIGINT, allowNull: true });
    }
  },

  async down(queryInterface) {
    const orders = await queryInterface.describeTable('orders');
    if (orders.couponLineBreakdown) await queryInterface.removeColumn('orders', 'couponLineBreakdown');
    const returns = await queryInterface.describeTable('return_requests');
    if (returns.offerAdjustmentPaise) await queryInterface.removeColumn('return_requests', 'offerAdjustmentPaise');
  },
};
