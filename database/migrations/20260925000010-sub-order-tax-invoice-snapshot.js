'use strict';

/**
 * Freeze each sub-order's tax invoice amounts when the invoice number is allocated
 * (checkout). Returns rewrite order lines afterwards; the invoice must keep what was
 * issued, with the credit note carrying the return. NULL on sub-orders placed before
 * this column: their invoice renders from the order lines as before.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sub_orders', 'taxInvoiceSnapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sub_orders', 'taxInvoiceSnapshot');
  },
};
