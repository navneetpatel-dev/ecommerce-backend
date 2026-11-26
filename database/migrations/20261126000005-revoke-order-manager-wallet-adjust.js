'use strict';

/**
 * `wallet.adjust` credits or debits any wallet with only a typed reason (no cap, no second
 * approver), so it is SUPER_ADMIN-only by default. Revokes it from ADMIN_ORDER_MANAGER on existing
 * databases (fresh ones get this from the roles seeder). Custom roles are left alone, since a
 * Super Admin granted those explicitly. Safe to run again.
 */
const ROLE = 'ADMIN_ORDER_MANAGER';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "RolePermissions"
       WHERE "roleId" IN (SELECT id FROM roles WHERE name = :role)
         AND "permissionId" IN (SELECT id FROM permissions WHERE key = 'wallet.adjust')`,
      { replacements: { role: ROLE } },
    );
  },

  async down(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.query(
      `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
       SELECT r.id, p.id, :now, :now
       FROM roles r, permissions p
       WHERE r.name = :role AND p.key = 'wallet.adjust'
         AND NOT EXISTS (
           SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
         )`,
      { replacements: { role: ROLE, now } },
    );
  },
};
