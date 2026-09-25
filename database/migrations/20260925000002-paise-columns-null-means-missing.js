'use strict';

/**
 * Make the frozen paise columns the single stored money value.
 *
 * sub_orders, order_items and commission_ledgers store each amount twice: a rupee
 * DECIMAL and a paise BIGINT that was NOT NULL DEFAULT 0, so 0 meant "no snapshot,
 * read the rupee column" and a genuine zero could not be stored. Readers that took
 * the paise column directly therefore saw 0 for every row written before the
 * pricing engine (return reversals, vendor reports, commission GST).
 *
 * 1. Backfill every paise column with exactly what frozenPaise() /
 *    sqlVendorNetPayoutPaise() read today, so no published figure changes.
 * 2. Drop NOT NULL and the 0 default: NULL now means "no snapshot", 0 means zero.
 *
 * Writes still fill both columns; retiring the rupee columns is a later release.
 */

const PAIRS = {
  sub_orders: [
    ['subtotalPaise', 'subtotal'],
    ['shippingCostPaise', 'shippingCost'],
    ['shippingDiscountAmountPaise', 'shippingDiscountAmount'],
    ['taxAmountPaise', 'taxAmount'],
    ['taxableAmountPaise', 'taxableAmount'],
    ['discountAmountPaise', 'discountAmount'],
    ['commissionAmountPaise', 'commissionAmount'],
    ['tcsAmountPaise', 'tcsAmount'],
    ['netPayoutAmountPaise', 'netPayoutAmount'],
  ],
  order_items: [
    ['unitPricePaise', 'unitPrice'],
    ['discountAmountPaise', 'discountAmount'],
    ['taxableAmountPaise', 'taxableAmount'],
    ['taxAmountPaise', 'taxAmount'],
    ['commissionAmountPaise', 'commissionAmount'],
    ['tcsAmountPaise', 'tcsAmount'],
    ['netPayoutAmountPaise', 'netPayoutAmount'],
  ],
  commission_ledgers: [
    ['saleAmountPaise', 'saleAmount'],
    ['commissionAmountPaise', 'commissionAmount'],
    ['taxableAmountPaise', 'taxableAmount'],
    ['discountAmountPaise', 'discountAmount'],
    ['taxAmountPaise', 'taxAmount'],
    ['tcsAmountPaise', 'tcsAmount'],
    ['shippingCollectedPaise', 'shippingCollected'],
    // netPayoutAmountPaise handled below: its fallback derives sale − commission − TCS.
  ],
};

/** The previous frozenPaise() read: paise when non-zero, else round(rupees × 100). */
function legacyRead(paise, rupees) {
  return `CASE
    WHEN COALESCE("${paise}", 0) <> 0 THEN "${paise}"
    ELSE ROUND(COALESCE("${rupees}", 0)::numeric * 100)::bigint
  END`;
}

/** The previous sqlVendorNetPayoutPaise() read on commission_ledgers. */
const LEGACY_LEDGER_NET = `CASE
  WHEN COALESCE("netPayoutAmountPaise", 0) <> 0 THEN "netPayoutAmountPaise"
  ELSE ROUND(
    (
      CASE
        WHEN "netPayoutAmount" IS NOT NULL THEN "netPayoutAmount"::numeric
        ELSE COALESCE("saleAmount", 0)::numeric
             - COALESCE("commissionAmount", 0)::numeric
             - COALESCE("tcsAmount", 0)::numeric
      END
    ) * 100
  )::bigint
END`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

      for (const [table, pairs] of Object.entries(PAIRS)) {
        const sets = pairs.map(([paise, rupees]) => `"${paise}" = ${legacyRead(paise, rupees)}`);
        if (table === 'commission_ledgers') {
          sets.push(`"netPayoutAmountPaise" = ${LEGACY_LEDGER_NET}`);
        }
        await run(`UPDATE ${table} SET ${sets.join(', ')}`);

        const columns = pairs.map(([paise]) => paise);
        if (table === 'commission_ledgers') columns.push('netPayoutAmountPaise');
        for (const column of columns) {
          await run(`ALTER TABLE ${table} ALTER COLUMN "${column}" DROP NOT NULL`);
          await run(`ALTER TABLE ${table} ALTER COLUMN "${column}" DROP DEFAULT`);
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      for (const [table, pairs] of Object.entries(PAIRS)) {
        const columns = pairs.map(([paise]) => paise);
        if (table === 'commission_ledgers') columns.push('netPayoutAmountPaise');
        for (const column of columns) {
          await run(`UPDATE ${table} SET "${column}" = 0 WHERE "${column}" IS NULL`);
          await run(`ALTER TABLE ${table} ALTER COLUMN "${column}" SET DEFAULT 0`);
          await run(`ALTER TABLE ${table} ALTER COLUMN "${column}" SET NOT NULL`);
        }
      }
    });
  },
};
