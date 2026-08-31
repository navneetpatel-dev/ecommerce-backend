'use strict';

/**
 * Backfill CN/DN vendor + against-invoice refs for pre-97 notes where possible.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE credit_notes cn
      SET
        "subOrderId" = COALESCE(cn."subOrderId", rr."subOrderId"),
        "vendorId" = COALESCE(cn."vendorId", so."vendorId"),
        "againstInvoiceNumber" = COALESCE(cn."againstInvoiceNumber", so."taxInvoiceNumber")
      FROM return_requests rr
      LEFT JOIN sub_orders so ON so.id = rr."subOrderId"
      WHERE cn."returnRequestId" = rr.id
        AND cn."deletedAt" IS NULL
        AND (
          cn."subOrderId" IS NULL
          OR cn."vendorId" IS NULL
          OR cn."againstInvoiceNumber" IS NULL
        );
    `);

    await queryInterface.sequelize.query(`
      UPDATE debit_notes dn
      SET
        "subOrderId" = COALESCE(dn."subOrderId", rr."subOrderId"),
        "againstInvoiceNumber" = COALESCE(dn."againstInvoiceNumber", so."taxInvoiceNumber")
      FROM return_requests rr
      LEFT JOIN sub_orders so ON so.id = rr."subOrderId"
      WHERE dn."returnRequestId" = rr.id
        AND dn."deletedAt" IS NULL
        AND (
          dn."subOrderId" IS NULL
          OR dn."againstInvoiceNumber" IS NULL
        );
    `);
  },

  async down() {
    // Non-destructive backfill — no-op on down.
  },
};
