'use strict';

const { randomUUID } = require('node:crypto');

/**
 * `team.manage`: list, add and remove a vendor's staff. Granted to VENDOR_OWNER (SUPER_ADMIN has
 * every key). Replaces the `payout.view` gate on /api/vendors/me/staff, which was a finance
 * permission standing in for team management. Fresh databases get it from the roles seeder; this
 * adds it to existing ones. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      const now = new Date();
      await run(
        `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
         SELECT :id, 'team.manage', :now, :now
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'team.manage')`,
        { id: randomUUID(), now },
      );
      await run(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         SELECT r.id, p.id, :now, :now
         FROM roles r, permissions p
         WHERE r.name = 'VENDOR_OWNER' AND p.key = 'team.manage'
           AND NOT EXISTS (
             SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
           )`,
        { now },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = 'team.manage');
       DELETE FROM permissions WHERE key = 'team.manage';`,
    );
  },
};
