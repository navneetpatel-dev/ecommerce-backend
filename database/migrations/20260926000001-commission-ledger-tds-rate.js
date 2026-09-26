'use strict';

/**
 * Freeze the Section 194-O TDS rate on each sale ledger at checkout, like the TCS
 * rate already is, so a later change to the platform rate only affects sales made
 * after it. The payout run withholds TDS at the ledger's own rate.
 *
 * Existing sale ledgers take the platform rate stored now (0.1% when none is saved).
 * NULL stays on adjustment rows (cashback cost), which carry no TDS.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'commission_ledgers',
        'tdsRatePercent',
        { type: Sequelize.DECIMAL(6, 3), allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE commission_ledgers
         SET "tdsRatePercent" = COALESCE(
           (SELECT (value->>'tdsRatePercent')::numeric FROM platform_settings
            WHERE key = 'platform' AND "deletedAt" IS NULL LIMIT 1),
           0.1)
         WHERE "referenceType" IS NULL`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('commission_ledgers', 'tdsRatePercent');
  },
};
