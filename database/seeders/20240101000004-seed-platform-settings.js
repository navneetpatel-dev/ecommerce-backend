'use strict';

const { v4: uuidv4 } = require('uuid');

const PLATFORM_VALUE = {
  defaultCommissionRate: 10,
  tcsRatePercent: 1,
  tdsRatePercent: 1,
  autoApproveProducts: false,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 500,
  supportEmail: 'support@inkandbrass.example',
  supportHours: 'Mon–Sat, 9:00 AM–7:00 PM',
  ticketReopenWindowDays: 7,
  bugVerifyWindowDays: 7,
  bugCloseWindowDays: 7,
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM platform_settings WHERE key = 'platform' AND "deletedAt" IS NULL LIMIT 1`,
    );

    if (existing.length > 0) {
      await queryInterface.sequelize.query(
        `UPDATE platform_settings
         SET value = :value::jsonb, "updatedAt" = :now
         WHERE key = 'platform' AND "deletedAt" IS NULL`,
        {
          replacements: {
            value: JSON.stringify(PLATFORM_VALUE),
            now,
          },
        },
      );
      return;
    }

    await queryInterface.bulkInsert('platform_settings', [{
      id: uuidv4(),
      key: 'platform',
      value: JSON.stringify(PLATFORM_VALUE),
      createdAt: now,
      updatedAt: now,
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('platform_settings', { key: 'platform' });
  },
};
