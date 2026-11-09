/**
 * Heavy demo data on top of `npm run db:seed`: every customer and every selling vendor
 * gets 100+ rows on each page they own, admins see it all, and the money adds up because
 * orders are priced by the checkout engine and payouts are made by the payout run itself.
 *
 *   npm run db:seed:demo                      # full dataset (takes a while)
 *   DEMO_SEED_SIZE=small npm run db:seed:demo # a quick miniature of the same
 *
 * Runs once per database (a marker is kept in platform_settings); refuses in production.
 */
import { sequelize } from '../../database/models';
import { phase, select, exec } from './lib';
import { SMALL } from './scale';
import { seedAccounts } from './accounts';
import { seedCatalog } from './catalog';
import { seedPromotions } from './promotions';
import { seedOrders } from './orders';
import { priceOrders } from './pricing';
import { seedAfterSales } from './afterSales';
import { seedWallets } from './wallets';
import { seedPayouts } from './payouts';
import { seedEngagement } from './engagement';
import { seedSupport } from './support';
import { seedSystem } from './system';
import { printCoverage } from './report';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertSeedingAllowed } = require('../../database/seedGuard');

const MARKER = 'demoSeed';

async function main() {
  assertSeedingAllowed('seed-demo');
  await sequelize.authenticate();
  const done = await select<{ key: string }>('SELECT key FROM platform_settings WHERE key = :key', { key: MARKER });
  if (done.length && !process.argv.includes('--force')) {
    console.log('Demo data is already seeded on this database (pass --force to add another round).');
    return;
  }
  const roles = await select<{ c: string }>('SELECT count(*)::text AS c FROM roles');
  if (Number(roles[0]!.c) === 0) throw new Error('Run `npm run db:seed` first: the demo seed builds on its roles, categories and accounts.');

  const started = Date.now();
  console.log(`Seeding ${SMALL ? 'a small' : 'the full'} demo dataset…`);
  const accounts = await phase('Accounts', seedAccounts);
  const catalog = await phase('Catalog', () => seedCatalog(accounts));
  const coupons = await phase('Promotions', () => seedPromotions(accounts, catalog));
  await phase('Orders', () => seedOrders(accounts, catalog, coupons));
  await phase('Pricing (checkout engine)', priceOrders);
  await phase('Returns, refunds and notes', () => seedAfterSales(accounts));
  await phase('Wallets, gift cards and cashback', () => seedWallets(accounts));
  await phase('Payouts (payout run)', () => seedPayouts(accounts));
  await phase('Reviews, Q&A, wishlists and carts', () => seedEngagement(accounts, catalog));
  await phase('Support tickets and bug reports', () => seedSupport(accounts));
  await phase('Notifications, audit, exports and system', () => seedSystem(accounts));

  await exec(
    `INSERT INTO platform_settings (id, key, value, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), :key, :value, now(), now()) ON CONFLICT DO NOTHING`,
    { key: MARKER, value: JSON.stringify({ seededAt: new Date().toISOString(), size: SMALL ? 'small' : 'full' }) },
  );
  await printCoverage(accounts);
  console.log(`\nDemo seed complete in ${((Date.now() - started) / 60_000).toFixed(1)} min.`);
}

// Importing the payout and notification modules opens queue connections that would keep
// the process alive, so it exits explicitly once the database is closed.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => undefined);
    process.exit();
  });
