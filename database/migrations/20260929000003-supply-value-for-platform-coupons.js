'use strict';

/**
 * The vendor's GST value of supply when the platform funds part of a coupon: the value
 * before the platform's share (its reimbursement is consideration for the sale) and the
 * GST on it. The vendor's invoice, credit notes, TCS and 194-O TDS use these; the
 * customer-facing taxable value and tax stay as they are. Null on rows written before
 * — readers fall back to the customer-facing columns, which were equal unless the
 * platform funded a coupon (and those were filed on that basis).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const nullableBigint = { type: Sequelize.BIGINT, allowNull: true };
    await queryInterface.addColumn('order_items', 'supplyTaxablePaise', nullableBigint);
    await queryInterface.addColumn('order_items', 'supplyTaxPaise', nullableBigint);
    await queryInterface.addColumn('sub_orders', 'supplyTaxablePaise', nullableBigint);
    await queryInterface.addColumn('sub_orders', 'supplyTaxPaise', nullableBigint);
    await queryInterface.addColumn('commission_ledgers', 'supplyTaxablePaise', nullableBigint);
    await queryInterface.addColumn('return_requests', 'refundSupplyTaxablePaise', nullableBigint);
    await queryInterface.addColumn('return_requests', 'refundSupplyTaxPaise', nullableBigint);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'refundSupplyTaxPaise');
    await queryInterface.removeColumn('return_requests', 'refundSupplyTaxablePaise');
    await queryInterface.removeColumn('commission_ledgers', 'supplyTaxablePaise');
    await queryInterface.removeColumn('sub_orders', 'supplyTaxPaise');
    await queryInterface.removeColumn('sub_orders', 'supplyTaxablePaise');
    await queryInterface.removeColumn('order_items', 'supplyTaxPaise');
    await queryInterface.removeColumn('order_items', 'supplyTaxablePaise');
  },
};
