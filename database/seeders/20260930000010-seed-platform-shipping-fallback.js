'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

const { randomUUID: uuidv4 } = require('node:crypto');

/**
 * Pan-India shipping zone + platform-wide fallback rates.
 *
 * The earlier zone seed only covered a subset of 2-digit pincode prefixes (no 8x/9x, 10, 19,
 * 49, 51-55, 57-59, 61-69, 71-79), and every rate it created belonged to one of the first 20
 * vendors. A cart shipped to any other pincode — or sold by any other vendor — resolved to
 * zero rates, so checkout failed with "No shipping rate is available for the selected method"
 * and the review step could not be priced at all.
 *
 * `resolveZonesForPincode` matches a zone with no pincode prefixes by state, so a zone with
 * `states: ['ALL']` and `pincodePrefixes: []` covers every pincode. Platform-wide rates have
 * `vendorId: NULL`, which is exactly the fallback `getRatesForQuote` looks for when a vendor
 * has no rates in the customer's zone. Prices match the per-vendor seed rates (STANDARD
 * ₹59 / free over ₹499, EXPRESS ₹129 / free over ₹999) so a fallback does not undercut them.
 *
 * Safe to re-run.
 */

const ZONE_NAME = 'All India';

/** Mirrors `20240101000003-comprehensive-seed.js`, which gave vendors 15 kg / 8 kg slabs. */
const PLATFORM_RATES = [
  {
    method: 'STANDARD',
    minWeightGrams: 0,
    maxWeightGrams: 15000,
    price: 59,
    estimatedDays: 5,
    freeShippingThreshold: 499,
  },
  {
    method: 'EXPRESS',
    minWeightGrams: 0,
    maxWeightGrams: 8000,
    price: 129,
    estimatedDays: 2,
    freeShippingThreshold: 999,
  },
];

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20260930000010-seed-platform-shipping-fallback.js');
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const [zones] = await queryInterface.sequelize.query(
        `SELECT id FROM shipping_zones
          WHERE name = :name AND "deletedAt" IS NULL
          ORDER BY "createdAt", id
          LIMIT 1`,
        { replacements: { name: ZONE_NAME }, transaction },
      );

      let zoneId = zones[0] && zones[0].id;
      if (!zoneId) {
        zoneId = uuidv4();
        await queryInterface.bulkInsert(
          'shipping_zones',
          [
            {
              id: zoneId,
              name: ZONE_NAME,
              // The ALL pseudo-state is what makes this zone match every pincode. No pincode
              // prefixes are inserted at all: Postgres cannot infer a type for an empty array
              // in a bulk insert, and the column already defaults to `{}`.
              states: ['ALL'],
              createdAt: now,
              updatedAt: now,
            },
          ],
          { transaction },
        );
      }

      let created = 0;
      for (const rate of PLATFORM_RATES) {
        const [existing] = await queryInterface.sequelize.query(
          `SELECT id FROM shipping_rates
            WHERE "zoneId" = :zoneId AND "vendorId" IS NULL
              AND method = :method AND "deletedAt" IS NULL
            LIMIT 1`,
          { replacements: { zoneId, method: rate.method }, transaction },
        );
        if (existing.length) continue;

        await queryInterface.bulkInsert(
          'shipping_rates',
          [
            {
              id: uuidv4(),
              zoneId,
              vendorId: null,
              ...rate,
              createdAt: now,
              updatedAt: now,
            },
          ],
          { transaction },
        );
        created += 1;
      }

      console.log(`✓ Pan-India shipping zone "${ZONE_NAME}" (${zoneId}) with ${created} new platform-wide rate(s)`);
    });
  },

  // The zone and its rates are the only coverage several pincodes have; removing them would
  // break checkout again, so a rollback leaves them in place.
  async down() {},
};
