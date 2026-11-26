'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Two permissions split out of broader ones so they can stay SUPER_ADMIN-only:
 *  - `cashback.manage`: platform cashback offers (used to ride on `coupon.manage`, held by the Catalog Manager).
 *  - `webvitals.view`: Web Vitals telemetry (used to ride on `analytics.view`, held by both managers).
 * Granted to SUPER_ADMIN only, mirroring the roles seeder. Fresh databases get them from the seeder;
 * this adds them to existing ones. Safe to run again.
 */
const KEYS = ['cashback.manage', 'webvitals.view'];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      for (const key of KEYS) {
        await queryInterface.sequelize.query(
          `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
           SELECT :id, :key, :now, :now
           WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = :key)`,
          { transaction, replacements: { id: randomUUID(), key, now } },
        );
      }
      await queryInterface.sequelize.query(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         SELECT r.id, p.id, :now, :now
         FROM roles r, permissions p
         WHERE r.name = 'SUPER_ADMIN' AND p.key IN (:keys)
           AND NOT EXISTS (
             SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
           )`,
        { transaction, replacements: { now, keys: KEYS } },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key IN (:keys))`,
        { transaction, replacements: { keys: KEYS } },
      );
      await queryInterface.sequelize.query(`DELETE FROM permissions WHERE key IN (:keys)`, {
        transaction,
        replacements: { keys: KEYS },
      });
    });
  },
};
