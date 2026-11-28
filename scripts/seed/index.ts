/**
 * The demo data, on top of the reference seeders (`npm run db:seed` runs both):
 * one super admin, 100 vendors and 100 customers on random yopmail.com addresses, a catalog in
 * which every vendor sells in every category, and the orders, returns, money, reviews and
 * support history the screens need. Orders are priced by the checkout engine and payouts are
 * made by the payout run itself, so the money adds up.
 *
 *   npm run db:reset        # drop, migrate and seed from scratch
 *   npm run db:seed:check   # re-run the data checks on a seeded database
 *
 * Logins are written to `seed-accounts.local.csv` (git-ignored). Seeds an empty catalog only,
 * and refuses to run in production.
 */
import './isolate';
import { sequelize } from '../../database/models';
import { phase, select } from './lib';
import { loadCredentials, writeCredentialSheet, CREDENTIALS_SHEET, type Credentials } from './credentials';
import { seedAccounts } from './accounts';
import { seedCatalog } from './catalog';
import { seedPromotions } from './promotions';
import { seedShipping } from './shipping';
import { seedOrders } from './orders';
import { priceOrders } from './pricing';
import { seedAfterSales } from './afterSales';
import { seedWallets } from './wallets';
import { seedPayouts } from './payouts';
import { seedEngagement } from './engagement';
import { seedSupport } from './support';
import { seedSystem } from './system';
import { settle } from './settle';
import { verify } from './verify';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertSeedingAllowed } = require('../../database/seedGuard');

async function writeSheet(credentials: Credentials) {
  const users = await select<{ role: string; name: string; email: string; store: string | null }>(
    `SELECT r.name AS role, u.name, u.email, v."businessName" AS store FROM users u JOIN roles r ON r.id = u."roleId"
     LEFT JOIN vendors v ON v.id = u."vendorId" ORDER BY array_position(ARRAY['SUPER_ADMIN', 'VENDOR_OWNER', 'CUSTOMER'], r.name::text), u.email`,
  );
  const roles: Record<string, [label: string, password: string]> = {
    SUPER_ADMIN: ['Super Admin', credentials.passwords.superAdmin],
    VENDOR_OWNER: ['Vendor', credentials.passwords.vendor],
    CUSTOMER: ['Customer', credentials.passwords.customer],
  };
  writeCredentialSheet(
    users.map((user) => ({ role: roles[user.role]![0], name: user.store ?? user.name, email: user.email, password: roles[user.role]![1] })),
  );
}

async function main() {
  assertSeedingAllowed('scripts/seed');
  await sequelize.authenticate();
  const credentials = loadCredentials();
  if (process.argv.includes('--check')) {
    await phase('Data checks', () => verify(credentials));
    return;
  }
  const [products] = await select<{ c: string }>('SELECT count(*)::text AS c FROM products');
  if (products!.c !== '0') {
    throw new Error('This database already holds a catalog. Rebuild it from scratch with `npm run db:reset`.');
  }

  const started = Date.now();
  const accounts = await phase('Accounts', () => seedAccounts(credentials));
  const catalog = await phase('Catalog', () => seedCatalog(accounts));
  await phase('Shipping zones and rates', seedShipping);
  const coupons = await phase('Promotions', () => seedPromotions(accounts, catalog));
  await phase('Orders', () => seedOrders(accounts, catalog, coupons));
  await phase('Pricing (checkout engine)', priceOrders);
  await phase('Returns, refunds and notes', () => seedAfterSales(accounts));
  await phase('Wallets, gift cards and cashback', () => seedWallets(accounts));
  await phase('Payouts (payout run)', () => seedPayouts(accounts));
  await phase('Reviews, Q&A, wishlists and carts', () => seedEngagement(accounts, catalog));
  await phase('Support tickets and bug reports', () => seedSupport(accounts));
  await phase('Notifications, audit, exports and system', () => seedSystem(accounts));
  await phase('Settling scheduled mail', settle);
  await phase('Data checks', () => verify(credentials));
  await writeSheet(credentials);
  console.log(`\nSeed complete in ${((Date.now() - started) / 60_000).toFixed(1)} min. Logins: ${CREDENTIALS_SHEET}`);
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
