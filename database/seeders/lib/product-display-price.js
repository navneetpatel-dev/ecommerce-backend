'use strict';

/**
 * Recompute every product's `displayPrice`: its listed (pre-GST) price with GST at its
 * rate — the nearest category rule up the tree, else the default rule, else 18%, with a
 * band's higher rate above its per-piece threshold (rules picked oldest first, then
 * lowest rate). The same resolution as `taxService` / `productDisplayPrice` in the app;
 * seeders that add products or change tax rules finish with it.
 */
async function refreshProductDisplayPrices(queryInterface) {
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
      AND p."displayPrice" IS DISTINCT FROM (r.price_paise + ROUND(r.price_paise * r.rate / 100)) / 100.0
  `);
}

/**
 * The MRP includes GST, so it may not be below what the customer pays. Seeded MRPs were
 * generated as a markup on the pre-GST price; where one ends up below the GST-inclusive
 * price, it is read as pre-GST too and given the product's GST (whole rupees, rounded
 * up), which keeps the seeded discount. MRPs already at or above the price are left as
 * they are. Run after `refreshProductDisplayPrices`.
 */
async function alignMrpWithGstPrices(queryInterface) {
  const [, result] = await queryInterface.sequelize.query(`
    UPDATE products
    SET "compareAtPrice" = GREATEST(
      CEIL("compareAtPrice" * "displayPrice" / NULLIF("basePrice", 0)),
      CEIL("displayPrice")
    )
    WHERE "compareAtPrice" IS NOT NULL
      AND "displayPrice" IS NOT NULL
      AND "compareAtPrice" < "displayPrice"
  `);
  return result?.rowCount ?? 0;
}

module.exports = { refreshProductDisplayPrices, alignMrpWithGstPrices };
