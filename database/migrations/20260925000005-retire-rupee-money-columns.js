'use strict';

/**
 * Retire the rupee copies of the frozen money columns: paise is the only stored value.
 *
 * sub_orders, order_items and commission_ledgers stored every PricingEngine amount
 * twice — a rupee DECIMAL and a paise BIGINT. 20260925000002 made paise the value
 * readers use, falling back to rupees only where paise was NULL. This finishes it:
 *
 * 1. Fill any paise still NULL from its rupee column (the old fallback, applied once).
 * 2. Make every paise column NOT NULL. Columns whose rupee twin defaulted to 0 keep
 *    that default, so an insert that omits an amount stores the same 0 it did before.
 * 3. Drop the 24 rupee columns. The models expose the rupee names as values derived
 *    from paise, so API responses keep their shape.
 *
 * Only the paired columns go. customerTotal, shippingCharged, lineSubtotal, lineTotal
 * and commissionRate have no paise twin and stay as they are.
 */

/** [paise, rupees, rupee column had DEFAULT 0, rupee column allowed NULL] */
const PAIRS = {
  sub_orders: [
    ['subtotalPaise', 'subtotal', false, false],
    ['shippingCostPaise', 'shippingCost', true, false],
    ['shippingDiscountAmountPaise', 'shippingDiscountAmount', true, false],
    ['taxAmountPaise', 'taxAmount', true, false],
    ['taxableAmountPaise', 'taxableAmount', true, false],
    ['discountAmountPaise', 'discountAmount', true, false],
    ['commissionAmountPaise', 'commissionAmount', true, true],
    ['tcsAmountPaise', 'tcsAmount', true, false],
    ['netPayoutAmountPaise', 'netPayoutAmount', true, false],
  ],
  order_items: [
    ['unitPricePaise', 'unitPrice', false, false],
    ['discountAmountPaise', 'discountAmount', true, false],
    ['taxableAmountPaise', 'taxableAmount', true, false],
    ['taxAmountPaise', 'taxAmount', true, false],
    ['commissionAmountPaise', 'commissionAmount', true, false],
    ['tcsAmountPaise', 'tcsAmount', true, false],
    ['netPayoutAmountPaise', 'netPayoutAmount', true, false],
  ],
  commission_ledgers: [
    ['saleAmountPaise', 'saleAmount', false, false],
    ['commissionAmountPaise', 'commissionAmount', false, false],
    ['taxableAmountPaise', 'taxableAmount', true, false],
    ['discountAmountPaise', 'discountAmount', true, false],
    ['taxAmountPaise', 'taxAmount', true, false],
    ['tcsAmountPaise', 'tcsAmount', true, false],
    ['netPayoutAmountPaise', 'netPayoutAmount', true, false],
    ['shippingCollectedPaise', 'shippingCollected', true, false],
  ],
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      for (const [table, pairs] of Object.entries(PAIRS)) {
        for (const [paise, rupees, hasZeroDefault] of pairs) {
          await run(
            `UPDATE ${table}
             SET "${paise}" = ROUND(COALESCE("${rupees}", 0)::numeric * 100)::bigint
             WHERE "${paise}" IS NULL`,
          );
          if (hasZeroDefault) {
            await run(`ALTER TABLE ${table} ALTER COLUMN "${paise}" SET DEFAULT 0`);
          }
          await run(`ALTER TABLE ${table} ALTER COLUMN "${paise}" SET NOT NULL`);
          await run(`ALTER TABLE ${table} DROP COLUMN "${rupees}"`);
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      for (const [table, pairs] of Object.entries(PAIRS)) {
        for (const [paise, rupees, hasZeroDefault, rupeeNullable] of pairs) {
          await run(`ALTER TABLE ${table} ADD COLUMN "${rupees}" DECIMAL(10, 2)`);
          await run(`UPDATE ${table} SET "${rupees}" = "${paise}"::numeric / 100`);
          if (hasZeroDefault) {
            await run(`ALTER TABLE ${table} ALTER COLUMN "${rupees}" SET DEFAULT 0`);
          }
          if (!rupeeNullable) {
            await run(`ALTER TABLE ${table} ALTER COLUMN "${rupees}" SET NOT NULL`);
          }
          // Back to 20260925000002's shape: nullable paise, no default.
          await run(`ALTER TABLE ${table} ALTER COLUMN "${paise}" DROP NOT NULL`);
          await run(`ALTER TABLE ${table} ALTER COLUMN "${paise}" DROP DEFAULT`);
        }
      }
    });
  },
};
