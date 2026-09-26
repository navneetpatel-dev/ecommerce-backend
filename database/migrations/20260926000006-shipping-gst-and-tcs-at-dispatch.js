'use strict';

/**
 * - sub_orders.shippingInvoiceSnapshot: the platform's tax invoice for the shipping it
 *   charged on the part (18% GST included in the fee, SAC 9968). Amounts frozen at
 *   checkout; number and date set when the part is dispatched. NULL when no shipping
 *   was charged, and on parts placed before this column.
 * - sub_orders.tcsRatePercent: the section 52 TCS rate frozen at checkout, so the TCS
 *   collection is recorded at dispatch (when the supply is invoiced) at the rate the
 *   sale was priced with.
 * - return_requests.returnFeeInvoiceSnapshot: the platform's tax invoice for a return
 *   shipping fee kept from a refund (GST included), issued with the refund.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sub_orders', 'shippingInvoiceSnapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('sub_orders', 'tcsRatePercent', {
      type: Sequelize.DECIMAL(6, 3),
      allowNull: true,
    });
    await queryInterface.addColumn('return_requests', 'returnFeeInvoiceSnapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'returnFeeInvoiceSnapshot');
    await queryInterface.removeColumn('sub_orders', 'tcsRatePercent');
    await queryInterface.removeColumn('sub_orders', 'shippingInvoiceSnapshot');
  },
};
