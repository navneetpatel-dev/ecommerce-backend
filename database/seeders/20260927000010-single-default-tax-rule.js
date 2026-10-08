'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

/**
 * One default tax rule (no category), at 18% — India's standard GST rate and what the app
 * charges when no rule applies at all. Earlier seeds created four defaults (5/12/18/28%),
 * which made the fallback GST arbitrary. Every other default rule is soft-deleted, as the
 * admin "delete rule" does, and every product's GST-inclusive price is recomputed (which
 * also fills it in for products seeded after the display-price migration). Seeded MRPs
 * that fall short of any variant's price with GST are given GST too (the MRP includes GST
 * and no piece may sell above it).
 *
 * Safe to re-run.
 */

const { v4: uuidv4 } = require('uuid');
const { alignMrpWithGstPrices, refreshProductDisplayPrices } = require('./lib/product-display-price');

const DEFAULT_GST_PERCENTAGE = 18;

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20260927000010-single-default-tax-rule.js');
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [keepers] = await queryInterface.sequelize.query(
        `SELECT id FROM tax_rules
          WHERE "categoryId" IS NULL AND "deletedAt" IS NULL
            AND "gstPercentage" = :rate
            AND "priceBandThreshold" IS NULL
          ORDER BY "createdAt", id
          LIMIT 1`,
        { replacements: { rate: DEFAULT_GST_PERCENTAGE }, transaction },
      );
      let keepId = keepers[0]?.id;
      if (!keepId) {
        keepId = uuidv4();
        await queryInterface.bulkInsert(
          'tax_rules',
          [
            {
              id: keepId,
              categoryId: null,
              hsnCode: `DEFAULT-${DEFAULT_GST_PERCENTAGE}`,
              gstPercentage: DEFAULT_GST_PERCENTAGE,
              createdAt: now,
              updatedAt: now,
            },
          ],
          { transaction },
        );
      }

      const [, removed] = await queryInterface.sequelize.query(
        `UPDATE tax_rules SET "deletedAt" = :now, "updatedAt" = :now
          WHERE "categoryId" IS NULL AND "deletedAt" IS NULL AND id <> :keepId`,
        { replacements: { now, keepId }, transaction },
      );
      console.log(
        `✓ Default tax rule: ${DEFAULT_GST_PERCENTAGE}% kept (${keepId}); ${removed?.rowCount ?? 0} other default rule(s) removed`,
      );
    });

    await refreshProductDisplayPrices(queryInterface);
    console.log('✓ Product GST-inclusive prices recomputed');
    const aligned = await alignMrpWithGstPrices(queryInterface);
    console.log(`✓ ${aligned} MRP(s) below a variant's GST-inclusive price given GST`);
  },

  // The removed rules were duplicates that made the default GST arbitrary; they are not
  // brought back. They stay soft-deleted in tax_rules if ever needed.
  async down() {},
};
