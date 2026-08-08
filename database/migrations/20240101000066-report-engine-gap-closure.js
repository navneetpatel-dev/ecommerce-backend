'use strict';

/**
 * Report engine gap closure:
 * - Sequential TAX_INVOICE document series
 * - orders.taxInvoiceNumber (allocated once on first PDF download)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const orderCols = await queryInterface.describeTable('orders');
    if (!orderCols.taxInvoiceNumber) {
      await queryInterface.addColumn('orders', 'taxInvoiceNumber', {
        type: Sequelize.STRING(32),
        allowNull: true,
        unique: true,
      });
    }

    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM document_sequences WHERE kind = 'TAX_INVOICE' LIMIT 1`,
    );
    if (!existing || existing.length === 0) {
      const now = new Date();
      await queryInterface.bulkInsert('document_sequences', [
        {
          id: '33333333-3333-4333-8333-333333333333',
          kind: 'TAX_INVOICE',
          nextValue: 1,
          prefix: 'INV',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM document_sequences WHERE kind = 'TAX_INVOICE'`,
    );
    const orderCols = await queryInterface.describeTable('orders');
    if (orderCols.taxInvoiceNumber) {
      await queryInterface.removeColumn('orders', 'taxInvoiceNumber');
    }
  },
};
