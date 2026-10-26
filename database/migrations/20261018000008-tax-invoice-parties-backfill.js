'use strict';

/**
 * Freeze the parties on tax invoices issued before they were frozen at issue: who each is
 * from (the vendor's name, GSTIN, state) and to (the buyer's GSTIN, state and address).
 * Until now GSTR-1 and the invoice PDF read them live, so a buyer adding a GSTIN to an
 * old address moved last quarter's invoices from B2C to B2B. These are the values as they
 * stand today: the best record left of what the invoice said, and they stop drifting.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE sub_orders so
      SET "taxInvoiceSnapshot" = so."taxInvoiceSnapshot" || jsonb_build_object('parties', p.parties)
      FROM (
        SELECT
          s.id,
          jsonb_build_object(
            'supplierName', v."businessName",
            'supplierGstin', NULLIF(TRIM(v."gstNumber"), ''),
            'supplierState', NULLIF(TRIM(v.state), ''),
            'recipientGstin', NULLIF(TRIM(a.gstin), ''),
            'recipientState', NULLIF(TRIM(a.state), ''),
            'recipientAddress', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
              'line1', a.line1, 'line2', a.line2, 'city', a.city,
              'state', a.state, 'pincode', a.pincode, 'country', a.country
            ) END
          ) AS parties
        FROM sub_orders s
        INNER JOIN orders o ON o.id = s."orderId"
        LEFT JOIN addresses a ON a.id = o."shippingAddressId"
        LEFT JOIN vendors v ON v.id = s."vendorId"
        WHERE s."taxInvoiceNumber" IS NOT NULL
          AND s."taxInvoiceSnapshot" IS NOT NULL
          AND (s."taxInvoiceSnapshot"->'parties') IS NULL
      ) p
      WHERE so.id = p.id
    `);
  },

  async down() {
    // The parties stay: removing them would put the invoices back on live data.
  },
};
