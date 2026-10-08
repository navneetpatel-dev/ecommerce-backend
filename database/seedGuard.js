'use strict';

/**
 * Production safety gate shared by every seeder.
 *
 * Seeding creates the documented demo/test accounts (admin@ecommerce.com,
 * vendors, customers — see docs/TEST_CREDENTIALS.md). Those must never be created
 * on a production database, so each seeder calls this before writing anything.
 *
 * Deliberate production seeding (e.g. first deploy of reference data) must opt
 * in explicitly with ALLOW_PROD_SEED=true.
 */
function assertSeedingAllowed(seederName) {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.ALLOW_PROD_SEED === 'true') return;
  throw new Error(
    `Refusing to run seeder "${seederName}" with NODE_ENV=production. ` + 'Set ALLOW_PROD_SEED=true to override deliberately.',
  );
}

module.exports = { assertSeedingAllowed };
