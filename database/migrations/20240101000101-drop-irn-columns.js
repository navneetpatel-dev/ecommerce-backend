'use strict';

/**
 * Drop e-invoice / IRN columns if a prior migration added them.
 */
module.exports = {
  async up(queryInterface) {
    const subCols = [
      'einvoiceError',
      'einvoiceStatus',
      'signedQrData',
      'irnAckDate',
      'irnAckNo',
      'irn',
    ];
    const cnCols = [
      'einvoiceError',
      'einvoiceStatus',
      'signedQrData',
      'irnAckDate',
      'irnAckNo',
      'irn',
    ];

    const names = await queryInterface.showAllTables();
    if (names.includes('sub_orders')) {
      const sub = await queryInterface.describeTable('sub_orders');
      for (const col of subCols) {
        if (sub[col]) await queryInterface.removeColumn('sub_orders', col);
      }
    }
    if (names.includes('credit_notes')) {
      const cn = await queryInterface.describeTable('credit_notes');
      for (const col of cnCols) {
        if (cn[col]) await queryInterface.removeColumn('credit_notes', col);
      }
    }
  },

  async down() {
    // IRN removal is intentional; no down migration.
  },
};
