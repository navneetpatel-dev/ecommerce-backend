'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Assisted listing: the platform can create and prepare a product on a vendor's behalf.
 *  - `products.listedByPlatform`: the product was created by the platform for the vendor.
 *  - `products.vendorConsentNote`: how the vendor agreed when an admin submits it on their behalf.
 *  - Permission `product.pricing`: change prices, MRP, tax code, COD or variants of a live product or
 *    one the platform did not list. Granted to SUPER_ADMIN only, mirroring the roles seeder.
 * Existing products keep `listedByPlatform = false`. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { transaction, replacements });
      await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS "listedByPlatform" BOOLEAN NOT NULL DEFAULT false`);
      await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS "vendorConsentNote" TEXT`);

      const now = new Date();
      await q(
        `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
         SELECT :id, 'product.pricing', :now, :now
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'product.pricing')`,
        { id: randomUUID(), now },
      );
      await q(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         SELECT r.id, p.id, :now, :now
         FROM roles r, permissions p
         WHERE r.name = 'SUPER_ADMIN' AND p.key = 'product.pricing'
           AND NOT EXISTS (
             SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
           )`,
        { now },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await q(`DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = 'product.pricing')`);
      await q(`DELETE FROM permissions WHERE key = 'product.pricing'`);
      await q(`ALTER TABLE products DROP COLUMN IF EXISTS "vendorConsentNote"`);
      await q(`ALTER TABLE products DROP COLUMN IF EXISTS "listedByPlatform"`);
    });
  },
};
