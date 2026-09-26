'use strict';

/**
 * Move stored platform settings still on the old 1% defaults to the current rates:
 * GST s.52 TCS 0.5% (from 10 Jul 2024) and 194-O TDS 0.1% (from 1 Oct 2024).
 * A rate an admin set to anything other than 1 is left alone.
 */

async function setRate(queryInterface, key, from, to) {
  await queryInterface.sequelize.query(
    `UPDATE platform_settings
     SET value = jsonb_set(value, '{${key}}', to_jsonb(:to::numeric)), "updatedAt" = NOW()
     WHERE key = 'platform' AND (value->>'${key}')::numeric = :from`,
    { replacements: { from, to } },
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await setRate(queryInterface, 'tcsRatePercent', 1, 0.5);
    await setRate(queryInterface, 'tdsRatePercent', 1, 0.1);
  },

  async down(queryInterface) {
    await setRate(queryInterface, 'tcsRatePercent', 0.5, 1);
    await setRate(queryInterface, 'tdsRatePercent', 0.1, 1);
  },
};
