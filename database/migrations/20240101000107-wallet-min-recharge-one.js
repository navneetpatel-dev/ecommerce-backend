'use strict';

/** Lower default wallet min recharge from ₹100 to ₹1 in stored platform settings. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE platform_settings
      SET value = jsonb_set(value, '{walletMinRechargeInr}', '1', true),
          "updatedAt" = NOW()
      WHERE key = 'platform'
        AND "deletedAt" IS NULL
        AND (
          value->>'walletMinRechargeInr' IS NULL
          OR (value->>'walletMinRechargeInr')::numeric = 100
        )
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE platform_settings
      SET value = jsonb_set(value, '{walletMinRechargeInr}', '100', true),
          "updatedAt" = NOW()
      WHERE key = 'platform'
        AND "deletedAt" IS NULL
        AND (value->>'walletMinRechargeInr')::numeric = 1
    `);
  },
};
