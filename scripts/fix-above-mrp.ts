/**
 * Listings that sell above their MRP (which includes GST), and a repair for DEMO data.
 *
 * Dry run (default): lists every product with an option above its MRP and the MRP that would
 * cover it. `--apply` raises those MRPs. On real data the MRP is printed on the goods, so the
 * vendor decides it: send them this list instead of applying.
 *
 * Usage (from `backend/`):
 *   npx tsx scripts/fix-above-mrp.ts            # report only, changes nothing
 *   npx tsx scripts/fix-above-mrp.ts --apply    # demo data only
 *
 * Works before and after migration 20261129000002 (which stops these options selling).
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { gstRuleResolver, priceWithRuleGst } from '@modules/tax/gstPricing';

type Row = { id: string; name: string; status: string; categoryId: string; mrp: string; prices: string[] };

async function main() {
  const rows = (await sequelize.query(
    `SELECT p.id, p.name, p.status, p."categoryId", p."compareAtPrice" AS mrp,
            COALESCE(array_agg(v.price) FILTER (WHERE v.id IS NOT NULL), ARRAY[p."basePrice"]) AS prices
     FROM products p
     LEFT JOIN product_variants v ON v."productId" = p.id AND v."deletedAt" IS NULL
     WHERE p."deletedAt" IS NULL AND p."compareAtPrice" IS NOT NULL
     GROUP BY p.id ORDER BY p.name`,
    { type: QueryTypes.SELECT },
  )) as Row[];

  const ruleFor = gstRuleResolver();
  let affected = 0;
  let options = 0;
  for (const row of rows) {
    const rule = await ruleFor(row.categoryId);
    const withGst = row.prices.map((price) => priceWithRuleGst(rule, price));
    const above = withGst.filter((price) => price > Number(row.mrp)).length;
    if (!above) continue;
    affected += 1;
    options += above;
    console.log(`${row.status}\t${row.name}\tMRP ${row.mrp} -> needs ${Math.ceil(Math.max(...withGst))}\t(${above} option(s))`);
  }
  console.log(`\n${affected} product(s), ${options} option(s) above their MRP.`);

  if (process.argv.includes('--apply') && affected > 0) {
    const { alignMrpWithGstPrices, refreshProductDisplayPrices, refreshAboveMrpFlags } = await import(
      '../database/seeders/lib/product-display-price.js' as string
    ).then((module) => module.default ?? module);
    const database = { sequelize };
    await refreshProductDisplayPrices(database);
    const raised = await alignMrpWithGstPrices(database);
    const [column] = (await sequelize.query(
      `SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'aboveMrp'`,
      { type: QueryTypes.SELECT },
    )) as Array<{ present: number }>;
    if (column) await refreshAboveMrpFlags(database);
    console.log(`Raised the MRP of ${raised} product(s).`);
  } else if (affected > 0) {
    console.log('Dry run: nothing changed. Use --apply on demo data only.');
  }
  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
