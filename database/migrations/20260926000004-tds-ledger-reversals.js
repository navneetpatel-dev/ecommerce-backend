'use strict';

/**
 * A return approved after the sale was paid out gives back the TDS withheld on it:
 * the vendor's next payout records a negative TDS row (a reversal) for the returned
 * sale value, so the 194-O TDS reported for the vendor is on its net sales.
 *
 * - `commissionLedgerId` links each TDS row to the ledger it was worked out from; a
 *   ledger gets at most one TDS row.
 * - The one-row-per-sub-order rule now applies to deductions only (tdsAmountPaise > 0),
 *   since a sub-order can also carry reversals for its returns.
 * - `ratePercent` widens to three decimals, like the rate frozen on sales.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'tds_ledgers',
        'commissionLedgerId',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );
      await queryInterface.changeColumn(
        'tds_ledgers',
        'ratePercent',
        { type: Sequelize.DECIMAL(6, 3), allowNull: false, defaultValue: 0 },
        { transaction },
      );
      await queryInterface.removeIndex('tds_ledgers', 'tds_ledgers_sub_order_unique', {
        transaction,
      });
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX tds_ledgers_sub_order_deduction_unique
         ON tds_ledgers ("subOrderId")
         WHERE "deletedAt" IS NULL AND "tdsAmountPaise" > 0`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX tds_ledgers_commission_ledger_unique
         ON tds_ledgers ("commissionLedgerId")
         WHERE "deletedAt" IS NULL AND "commissionLedgerId" IS NOT NULL`,
        { transaction },
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Reversal rows cannot survive the old one-row-per-sub-order rule.
      await queryInterface.sequelize.query(
        `UPDATE tds_ledgers SET "deletedAt" = NOW()
         WHERE "tdsAmountPaise" < 0 AND "deletedAt" IS NULL`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        'DROP INDEX IF EXISTS tds_ledgers_commission_ledger_unique',
        { transaction },
      );
      await queryInterface.sequelize.query(
        'DROP INDEX IF EXISTS tds_ledgers_sub_order_deduction_unique',
        { transaction },
      );
      await queryInterface.addIndex('tds_ledgers', ['subOrderId'], {
        unique: true,
        name: 'tds_ledgers_sub_order_unique',
        where: { deletedAt: null },
        transaction,
      });
      await queryInterface.changeColumn(
        'tds_ledgers',
        'ratePercent',
        { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        { transaction },
      );
      await queryInterface.removeColumn('tds_ledgers', 'commissionLedgerId', { transaction });
    });
  },
};
