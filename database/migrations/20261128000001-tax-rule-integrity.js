'use strict';

/**
 * One tax rule per category and one platform default, enforced by the database.
 *
 * Until now nothing stopped a category from getting several rules (or several defaults), and the
 * "oldest rule, then lowest rate" tie-break quietly decided. This keeps exactly the rule that would
 * have won (same order as `TaxRepository`) and soft-deletes the others, then adds two partial unique
 * indexes so it cannot happen again. Safe to run again.
 */
const KEEP_ORDER = `ORDER BY "createdAt" ASC, "gstPercentage" ASC, id ASC`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await q(`
        UPDATE tax_rules SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY "categoryId" ${KEEP_ORDER}) AS rn
            FROM tax_rules WHERE "categoryId" IS NOT NULL AND "deletedAt" IS NULL
          ) ranked WHERE rn > 1
        )`);
      await q(`
        UPDATE tax_rules SET "deletedAt" = NOW(), "updatedAt" = NOW()
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (${KEEP_ORDER}) AS rn
            FROM tax_rules WHERE "categoryId" IS NULL AND "deletedAt" IS NULL
          ) ranked WHERE rn > 1
        )`);

      await q(`CREATE UNIQUE INDEX IF NOT EXISTS tax_rules_one_per_category
               ON tax_rules ("categoryId") WHERE "categoryId" IS NOT NULL AND "deletedAt" IS NULL`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS tax_rules_one_default
               ON tax_rules ((1)) WHERE "categoryId" IS NULL AND "deletedAt" IS NULL`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS tax_rules_one_default');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS tax_rules_one_per_category');
  },
};
