'use strict';

/**
 * `audit.view` is SUPER_ADMIN-only by default: the audit log records every admin's actions and
 * the platform-wide history. Revokes it from the built-in manager roles on existing databases
 * (fresh ones get this from the roles seeder). Custom roles are left alone. Safe to run again.
 */
const MANAGER_ROLES = ['ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER'];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "RolePermissions"
       WHERE "roleId" IN (SELECT id FROM roles WHERE name IN (:roles))
         AND "permissionId" IN (SELECT id FROM permissions WHERE key = 'audit.view')`,
      { replacements: { roles: MANAGER_ROLES } },
    );
  },

  async down(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.query(
      `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
       SELECT r.id, p.id, :now, :now
       FROM roles r, permissions p
       WHERE r.name IN (:roles) AND p.key = 'audit.view'
         AND NOT EXISTS (
           SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
         )`,
      { replacements: { roles: MANAGER_ROLES, now } },
    );
  },
};
