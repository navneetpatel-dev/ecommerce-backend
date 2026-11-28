'use strict';

/**
 * Deleted rows must not keep names reserved, and sibling categories must not share one.
 *  - A variant SKU is unique among variants that still exist (it was unique even against deleted
 *    ones, so re-adding a removed SKU failed with a server error).
 *  - A deleted product gives up its slug (it is suffixed), so its name can be used again.
 *  - Categories under the same parent have different names, ignoring case. Existing repeats are
 *    numbered ("Name (2)") first; the same name under different parents stays allowed.
 * Safe to run again.
 */
const ROOT = `'00000000-0000-0000-0000-000000000000'::uuid`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await q(`ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key`);
      await q(`DROP INDEX IF EXISTS product_variants_sku_key`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_live ON product_variants (sku) WHERE "deletedAt" IS NULL`);

      await q(`
        UPDATE products SET slug = left(slug, 220) || '--deleted-' || left(id::text, 8)
        WHERE "deletedAt" IS NOT NULL AND slug NOT LIKE '%--deleted-%'`);

      await q(`
        UPDATE categories c SET name = c.name || ' (' || ranked.rn || ')', "updatedAt" = NOW()
        FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY COALESCE("parentId", ${ROOT}), lower(name) ORDER BY "createdAt", id
          ) AS rn
          FROM categories WHERE "deletedAt" IS NULL
        ) ranked
        WHERE ranked.id = c.id AND ranked.rn > 1`);
      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS categories_sibling_name
        ON categories (COALESCE("parentId", ${ROOT}), lower(name)) WHERE "deletedAt" IS NULL`);
    });
  },

  // Freed slugs and numbered names are kept: putting them back could collide with rows made since.
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS categories_sibling_name');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS product_variants_sku_live');
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM product_variants GROUP BY sku HAVING count(*) > 1) THEN
          ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);
        END IF;
      END $$`);
  },
};
