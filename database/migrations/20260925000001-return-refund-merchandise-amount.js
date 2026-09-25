'use strict';

/**
 * Persist the merchandise (pre-tax item) part of a return refund, as PricingEngine
 * computed it at approval. Readers used to back it out as
 * refundAmount − refundTaxAmount − shippingRefundAmount + returnShippingFeeAmount,
 * which is wrong whenever the return fee exceeded the refund and the refund was
 * clamped to 0.
 *
 * Backfill: the TCS return-adjustment ledger row stores the exact engine value
 * (−refundMerchandisePaise) when TCS applied; otherwise the old derivation, which
 * matches the engine for every unclamped refund.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('return_requests');
    if (!table.refundMerchandiseAmount) {
      await queryInterface.addColumn('return_requests', 'refundMerchandiseAmount', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE return_requests rr
      SET "refundMerchandiseAmount" = COALESCE(
        (
          SELECT ROUND(-SUM(t."taxableAmountPaise")::numeric / 100, 2)
          FROM tcs_ledgers t
          WHERE t."returnRequestId" = rr.id
            AND t."entryType" = 'RETURN_ADJUSTMENT'
            AND t."deletedAt" IS NULL
          HAVING COUNT(*) > 0
        ),
        GREATEST(
          0,
          rr."refundAmount"
            - COALESCE(rr."refundTaxAmount", 0)
            - COALESCE(rr."shippingRefundAmount", 0)
            + COALESCE(rr."returnShippingFeeAmount", 0)
        )
      )
      WHERE rr."refundAmount" IS NOT NULL
        AND rr."refundMerchandiseAmount" IS NULL
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('return_requests');
    if (table.refundMerchandiseAmount) {
      await queryInterface.removeColumn('return_requests', 'refundMerchandiseAmount');
    }
  },
};
