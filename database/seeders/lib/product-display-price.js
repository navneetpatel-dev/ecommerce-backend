'use strict';

/**
 * Each product's GST rule: the nearest category rule up the tree, else the default rule,
 * else 18% (rules picked oldest first, then lowest rate) — as `taxService` resolves it.
 * Columns: pid, g (rate), t (band threshold, rupees per piece), ga (rate above the band).
 */
const PRODUCT_RULE_CTES = `
  anc AS (
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
  product_rule AS (
    SELECT p.id AS pid,
      CASE WHEN cr.pid IS NOT NULL THEN cr.g WHEN dr.g IS NOT NULL THEN dr.g ELSE 18 END AS g,
      CASE WHEN cr.pid IS NOT NULL THEN cr.t ELSE dr.t END AS t,
      CASE WHEN cr.pid IS NOT NULL THEN cr.ga ELSE dr.ga END AS ga
    FROM products p
    LEFT JOIN category_rule cr ON cr.pid = p.id
    LEFT JOIN default_rule dr ON true
  )`;

/** A pre-GST price (rupees) with GST at rule `r`, in paise: the band rate above the band. */
function withGstPaiseSql(price, r) {
  return `(ROUND(${price} * 100) + ROUND(ROUND(${price} * 100) *
    (CASE WHEN ${r}.t IS NOT NULL AND ${r}.ga IS NOT NULL AND ${price} > ${r}.t THEN ${r}.ga ELSE ${r}.g END) / 100))`;
}

/**
 * Recompute every product's `displayPrice`: its listed (pre-GST) price with GST at its
 * rule. The same figure as `productDisplayPrice` in the app; seeders that add products or
 * change tax rules finish with it.
 */
async function refreshProductDisplayPrices(queryInterface) {
  await queryInterface.sequelize.query(`
    WITH RECURSIVE ${PRODUCT_RULE_CTES}
    UPDATE products p
    SET "displayPrice" = ${withGstPaiseSql('p."basePrice"', 'r')} / 100.0
    FROM product_rule r
    WHERE r.pid = p.id
      AND p."displayPrice" IS DISTINCT FROM ${withGstPaiseSql('p."basePrice"', 'r')} / 100.0
  `);
}

/**
 * The MRP includes GST, so no piece may sell above it: it must cover every variant's
 * price with GST (the product's own price without variants). Seeded MRPs were generated
 * as a markup on the pre-GST price; one that falls short is read as pre-GST too and given
 * the product's GST, which keeps the seeded discount, and is raised further if a dearer
 * variant still exceeds it (whole rupees, rounded up). MRPs that already cover every
 * price are left as they are.
 */
async function alignMrpWithGstPrices(queryInterface) {
  const [, result] = await queryInterface.sequelize.query(`
    WITH RECURSIVE ${PRODUCT_RULE_CTES},
    highest AS (
      SELECT r.pid, MAX(${withGstPaiseSql('v.price', 'r')}) AS paise
      FROM product_rule r
      INNER JOIN product_variants v ON v."productId" = r.pid AND v."deletedAt" IS NULL
      GROUP BY r.pid
    ),
    needed AS (
      SELECT p.id, GREATEST(ROUND(p."displayPrice" * 100), COALESCE(h.paise, 0)) AS paise
      FROM products p
      LEFT JOIN highest h ON h.pid = p.id
      WHERE p."displayPrice" IS NOT NULL
    )
    UPDATE products p
    SET "compareAtPrice" = GREATEST(
      CEIL(p."compareAtPrice" * p."displayPrice" / NULLIF(p."basePrice", 0)),
      CEIL(n.paise / 100.0)
    )
    FROM needed n
    WHERE n.id = p.id
      AND p."compareAtPrice" IS NOT NULL
      AND ROUND(p."compareAtPrice" * 100) < n.paise
  `);
  return result?.rowCount ?? 0;
}

module.exports = { refreshProductDisplayPrices, alignMrpWithGstPrices };
