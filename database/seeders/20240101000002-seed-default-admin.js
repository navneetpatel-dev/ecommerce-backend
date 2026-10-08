'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20240101000002-seed-default-admin.js');
    const now = new Date();
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@ecommerce.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

    // The defaults above are dev conveniences. A deliberate production seed
    // (ALLOW_PROD_SEED=true) must supply real values — never the demo password.
    if (process.env.NODE_ENV === 'production' && adminPassword === 'Admin@123') {
      throw new Error(
        'Refusing to seed the default admin password in production. ' +
          'Set ADMIN_PASSWORD (and ADMIN_EMAIL) explicitly.',
      );
    }

    const [role] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE name = 'SUPER_ADMIN' LIMIT 1`,
      { type: queryInterface.sequelize.QueryTypes.SELECT },
    );
    if (!role) {
      console.warn('SUPER_ADMIN role not found — skipping admin seeder');
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await queryInterface.bulkInsert('users', [
      {
        id: uuidv4(),
        email: adminEmail,
        passwordHash,
        name: 'Super Admin',
        phone: null,
        status: 'ACTIVE',
        roleId: role.id,
        vendorId: null,
        emailVerified: true,
        emailMarketingConsent: false,
        emailSuppressed: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@ecommerce.com';
    await queryInterface.bulkDelete('users', { email: adminEmail }, {});
  },
};
