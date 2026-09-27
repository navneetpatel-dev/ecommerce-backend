'use strict';

/**
 * products.displayPrice: the listed (pre-GST) price with GST at the product's rate — the
 * price customers see, filter and sort by. The rate is the nearest category rule up the
 * tree, else the default rule, else 18% (as taxService resolves it; rules picked oldest
 * first, then lowest rate), with the band's higher rate above its per-piece threshold.
 * The app keeps it current; this backfills existing products.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'displayPrice', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.sequelize.query(`
      WITH RECURSIVE anc AS (
        SELECT p.id AS pid, p."categoryId" AS cid, 0 AS depth
        FROM products p
        WHERE p."categoryId" IS NOT NULL
        UNION ALL
        SELECT a.pid, c."parentId", a.depth + 1
        FROM anc a
        INNER JOIN categories c ON c.id = a.cid
        WHERE c."parentId" IS NOT NULL AND a.depth < 20
      ),
      category_rule AS (
        SELECT DISTINCT ON (a.pid)
          a.pid, tr."gstPercentage" AS g, tr."priceBandThreshold" AS t, tr."gstPercentageAbove" AS ga
        FROM anc a
        INNER JOIN tax_rules tr ON tr."categoryId" = a.cid AND tr."deletedAt" IS NULL
        ORDER BY a.pid, a.depth, tr."createdAt", tr."gstPercentage", tr.id
      ),
      default_rule AS (
        SELECT "gstPercentage" AS g, "priceBandThreshold" AS t, "gstPercentageAbove" AS ga
        FROM tax_rules
        WHERE "categoryId" IS NULL AND "deletedAt" IS NULL
        ORDER BY "createdAt", "gstPercentage", id
        LIMIT 1
      ),
      resolved AS (
        SELECT p.id,
          ROUND(p."basePrice" * 100) AS price_paise,
          CASE
            WHEN cr.pid IS NOT NULL THEN
              CASE WHEN cr.t IS NOT NULL AND cr.ga IS NOT NULL AND p."basePrice" > cr.t THEN cr.ga ELSE cr.g END
            WHEN dr.g IS NOT NULL THEN
              CASE WHEN dr.t IS NOT NULL AND dr.ga IS NOT NULL AND p."basePrice" > dr.t THEN dr.ga ELSE dr.g END
            ELSE 18
          END AS rate
        FROM products p
        LEFT JOIN category_rule cr ON cr.pid = p.id
        LEFT JOIN default_rule dr ON true
      )
      UPDATE products p
      SET "displayPrice" = (r.price_paise + ROUND(r.price_paise * r.rate / 100)) / 100.0
      FROM resolved r
      WHERE r.id = p.id
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'displayPrice');
  },
};
