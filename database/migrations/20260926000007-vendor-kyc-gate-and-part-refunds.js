'use strict';

/**
 * - vendors.kycVerified: every KYC document the vendor needs (for its entity type and
 *   categories) is verified. A vendor sells only while it is APPROVED and this is true;
 *   the app keeps it current whenever a document or the vendor's categories change.
 *   Backfilled here from the same rules (resolveRequiredDocuments in the app).
 * - sub_orders.cancelRefund*: the card (Razorpay) refund for a part that was cancelled
 *   or came back undelivered — amount, Razorpay refund id and status — so a failed
 *   refund is visible and can be retried, and settled refunds reconcile.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vendors', 'kycVerified', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.sequelize.query(`
      WITH RECURSIVE vendor_cats AS (
        SELECT vc."vendorId", c.id, c."parentId"
        FROM vendor_categories vc
        INNER JOIN categories c ON c.id = vc."categoryId"
        WHERE vc."deletedAt" IS NULL
        UNION
        SELECT vcats."vendorId", p.id, p."parentId"
        FROM vendor_cats vcats
        INNER JOIN categories p ON p.id = vcats."parentId"
      ),
      matched AS (
        SELECT DISTINCT v.id AS "vendorId", dr."documentType"::text AS type
        FROM vendors v
        INNER JOIN document_requirements dr
          ON dr."deletedAt" IS NULL
          AND dr."isMandatory" = true
          AND (
            (dr."entityType" IS NULL AND dr."categoryId" IS NULL)
            OR (dr."entityType"::text = v."entityType"::text AND dr."categoryId" IS NULL)
            OR dr."categoryId" IN (SELECT vc.id FROM vendor_cats vc WHERE vc."vendorId" = v.id)
          )
      ),
      required AS (
        SELECT "vendorId", type FROM matched
        UNION ALL
        -- No rules seeded for the vendor: the universal base set (as the app falls back).
        SELECT v.id, base.type
        FROM vendors v
        CROSS JOIN (VALUES ('GST_CERT'), ('PAN'), ('AADHAAR'), ('BANK_PROOF'),
                           ('ADDRESS_PROOF'), ('AUTHORIZED_SIGNATORY_ID')) AS base(type)
        WHERE NOT EXISTS (SELECT 1 FROM matched m WHERE m."vendorId" = v.id)
      )
      UPDATE vendors v
      SET "kycVerified" = NOT EXISTS (
        SELECT 1 FROM required r
        WHERE r."vendorId" = v.id
          AND NOT EXISTS (
            SELECT 1 FROM vendor_documents d
            WHERE d."vendorId" = v.id
              AND d.type::text = r.type
              AND d.verified = true
              AND d."deletedAt" IS NULL
          )
      )
    `);

    await queryInterface.addColumn('sub_orders', 'cancelRefundAmountPaise', {
      type: Sequelize.BIGINT,
      allowNull: true,
    });
    await queryInterface.addColumn('sub_orders', 'cancelRefundStatus', {
      type: Sequelize.STRING(16),
      allowNull: true,
    });
    await queryInterface.addColumn('sub_orders', 'cancelRazorpayRefundId', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    // The card refund recorded on the order itself: a full cancellation. Refunds from
    // before per-part tracking all sit on the order, and the last part's refund took
    // whatever Razorpay still held, so together they returned the whole card amount.
    await queryInterface.addColumn('orders', 'cancelRefundAmountPaise', {
      type: Sequelize.BIGINT,
      allowNull: true,
    });
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET "cancelRefundAmountPaise" = ROUND("razorpayAmountPaid" * 100)::bigint
      WHERE "cancelRazorpayRefundId" IS NOT NULL
        AND "cancelRefundStatus" IN ('INITIATED', 'COMPLETED')
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'cancelRefundAmountPaise');
    await queryInterface.removeColumn('sub_orders', 'cancelRazorpayRefundId');
    await queryInterface.removeColumn('sub_orders', 'cancelRefundStatus');
    await queryInterface.removeColumn('sub_orders', 'cancelRefundAmountPaise');
    await queryInterface.removeColumn('vendors', 'kycVerified');
  },
};
