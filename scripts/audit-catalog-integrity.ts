/**
 * Catalog data the fixed bugs may have left behind.
 *
 * Read-only by default. `--apply` makes only the repairs that cannot lose anything or change what
 * anyone is charged: archiving active categories under archived ones, re-arming guest alerts that
 * were marked as sent but never mailed, and spelling variant option names as their category's
 * filters do. Everything else is listed for a person to decide.
 *
 * Usage (from `backend/`, after `npm run db:migrate`):
 *   npx tsx scripts/audit-catalog-integrity.ts
 *   npx tsx scripts/audit-catalog-integrity.ts --apply
 *
 * Not detectable: stock overwritten by saving a variant while orders came in (vendors should
 * recount their stock).
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { areCategoryDocumentsSatisfied } from '@modules/vendors/documentRequirements';
import type { VendorEntityType } from '@core/constants/statuses';

const APPLY = process.argv.includes('--apply');
const SHOWN = 20;

const select = <T>(sql: string) => sequelize.query(sql, { type: QueryTypes.SELECT }) as Promise<T[]>;

type Finding = { title: string; advice: string; items: string[]; repair?: () => Promise<unknown> };

async function named(title: string, advice: string, sql: string, repair?: () => Promise<unknown>): Promise<Finding> {
  const rows = await select<{ label: string }>(sql);
  return { title, advice, items: rows.map((row) => row.label), repair };
}

const LIVE = `p."deletedAt" IS NULL AND p.status = 'LIVE'`;

const ACTIVE_UNDER_ARCHIVED = `
  WITH RECURSIVE hidden AS (
    SELECT id, name FROM categories WHERE status = 'ARCHIVED'
    UNION
    SELECT c.id, c.name FROM categories c INNER JOIN hidden h ON c."parentId" = h.id
  )
  SELECT c.id, c.name FROM categories c INNER JOIN hidden h ON h.id = c.id WHERE c.status = 'ACTIVE'`;

const UNSENT_GUEST_ALERTS = `
  SELECT a.id, a."guestEmail" AS email FROM stock_alerts a
  WHERE a."guestEmail" IS NOT NULL AND a."notifiedAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM notification_logs l
      WHERE lower(l."recipientEmail") = lower(a."guestEmail") AND l.type = 'STOCK_ALERT_REQUESTED'
    )`;

/** Variant option names that differ only in capitals from an attribute of the product's category. */
const MISSPELT_OPTIONS = `
  SELECT v.id, v.sku, k.key AS found, a.name AS expected
  FROM product_variants v
  INNER JOIN products p ON p.id = v."productId" AND p."deletedAt" IS NULL
  INNER JOIN category_attributes a ON a."categoryId" = p."categoryId" AND a."deletedAt" IS NULL
  CROSS JOIN LATERAL jsonb_object_keys(
    CASE WHEN jsonb_typeof(v.attributes) = 'object' THEN v.attributes ELSE '{}'::jsonb END
  ) AS k(key)
  WHERE v."deletedAt" IS NULL AND lower(k.key) = lower(a.name) AND k.key <> a.name
    AND NOT v.attributes ? a.name`;

async function kycFinding(): Promise<Finding> {
  const rows = await select<{ vendorId: string; vendor: string; entityType: VendorEntityType | null; categoryId: string; category: string; n: number }>(
    `SELECT v.id AS "vendorId", v."businessName" AS vendor, v."entityType" AS "entityType",
            c.id AS "categoryId", c.name AS category, count(*)::int AS n
     FROM products p
     INNER JOIN vendors v ON v.id = p."vendorId"
     INNER JOIN categories c ON c.id = p."categoryId"
     WHERE ${LIVE} AND EXISTS (SELECT 1 FROM document_requirements d WHERE d."categoryId" = c.id AND d."deletedAt" IS NULL)
     GROUP BY v.id, c.id`,
  );
  const items: string[] = [];
  for (const row of rows) {
    if (!(await areCategoryDocumentsSatisfied(row.vendorId, row.entityType, [row.categoryId]))) {
      items.push(`${row.vendor}: ${row.n} live product(s) in ${row.category}`);
    }
  }
  return { title: 'Live products in categories whose documents the vendor lacks', advice: 'Collect the documents, or move or archive the products.', items };
}

async function findings(): Promise<Finding[]> {
  const hidden = await select<{ id: string; name: string }>(ACTIVE_UNDER_ARCHIVED);
  const alerts = await select<{ id: string; email: string }>(UNSENT_GUEST_ALERTS);
  const options = await select<{ id: string; sku: string; found: string; expected: string }>(MISSPELT_OPTIONS);

  return [
    await named('Products without a vendor', 'They cannot be sold. Delete them or re-create them for a vendor.',
      `SELECT p.name || ' (' || p.status || ')' AS label FROM products p WHERE p."deletedAt" IS NULL AND p."vendorId" IS NULL`),
    await named('Live products with no variant', 'The vendor adds a variant, or archive the listing.',
      `SELECT p.name AS label FROM products p WHERE ${LIVE} AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v."productId" = p.id AND v."deletedAt" IS NULL)`),
    await named('Live products with no image', 'The vendor adds an image.',
      `SELECT p.name AS label FROM products p WHERE ${LIVE} AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i."productId" = p.id AND i."deletedAt" IS NULL)`),
    await named('Published products with options above their MRP (not on sale)', 'The vendor corrects the price or MRP; see scripts/fix-above-mrp.ts.',
      `SELECT p.name || ': ' || count(v.id) || ' option(s)' AS label FROM products p
       INNER JOIN product_variants v ON v."productId" = p.id AND v."deletedAt" IS NULL AND v."aboveMrp"
       WHERE p."deletedAt" IS NULL AND p.status IN ('LIVE', 'PENDING_APPROVAL') GROUP BY p.id`),
    await kycFinding(),
    await named('No default tax rule (categories without their own rule use 18%)', 'Add the default rule on the Tax page.',
      `SELECT 'default rule missing' AS label WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE "categoryId" IS NULL AND "deletedAt" IS NULL)`),
    {
      title: 'Active categories under an archived one',
      advice: '--apply archives them.',
      items: hidden.map((row) => row.name),
      repair: () => sequelize.query(`UPDATE categories SET status = 'ARCHIVED', "updatedAt" = now() WHERE id IN (:ids)`, { replacements: { ids: hidden.map((row) => row.id) } }),
    },
    {
      title: 'Guest stock alerts marked as sent but never mailed',
      advice: '--apply re-arms them.',
      items: alerts.map((row) => row.email.replace(/^(.).*(@.*)$/, '$1***$2')),
      repair: () => sequelize.query(`UPDATE stock_alerts SET "notifiedAt" = NULL, "updatedAt" = now() WHERE id IN (:ids)`, { replacements: { ids: alerts.map((row) => row.id) } }),
    },
    {
      title: 'Variant option names spelt differently from the category filter',
      advice: '--apply renames them.',
      items: options.map((row) => `${row.sku}: ${row.found} -> ${row.expected}`),
      repair: async () => {
        for (const row of options) {
          await sequelize.query(
            `UPDATE product_variants SET attributes = (attributes - :found::text) || jsonb_build_object(:expected::text, attributes -> :found::text), "updatedAt" = now() WHERE id = :id`,
            { replacements: row },
          );
        }
      },
    },
  ];
}

async function main() {
  let total = 0;
  for (const finding of await findings()) {
    if (!finding.items.length) continue;
    total += finding.items.length;
    console.log(`\n## ${finding.title}: ${finding.items.length}\n   ${finding.advice}`);
    for (const item of finding.items.slice(0, SHOWN)) console.log(`   - ${item}`);
    if (finding.items.length > SHOWN) console.log(`   ... and ${finding.items.length - SHOWN} more`);
    if (APPLY && finding.repair) {
      await finding.repair();
      console.log('   repaired');
    }
  }
  console.log(`\n${total} finding(s).${total && !APPLY ? ' Nothing changed (read-only).' : ''}`);
  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
