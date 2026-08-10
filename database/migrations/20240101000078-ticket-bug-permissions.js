'use strict';

const { v4: uuidv4 } = require('uuid');

/** Adds ticket.manage and bug_report.manage for existing databases (fresh installs get them via roles seeder). */

const PERMISSION_KEYS = ['ticket.manage', 'bug_report.manage'];
const ROLE_NAMES = ['SUPER_ADMIN', 'ADMIN_ORDER_MANAGER'];

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    for (const key of PERMISSION_KEYS) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM permissions WHERE key = :key LIMIT 1`,
        { replacements: { key } },
      );
      let permissionId;
      if (existing.length > 0) {
        permissionId = existing[0].id;
      } else {
        permissionId = uuidv4();
        await queryInterface.bulkInsert('permissions', [
          { id: permissionId, key, createdAt: now, updatedAt: now },
        ]);
      }

      const [roles] = await queryInterface.sequelize.query(
        `SELECT id, name FROM roles WHERE name IN (:roleNames)`,
        { replacements: { roleNames: ROLE_NAMES } },
      );

      for (const role of roles) {
        const [link] = await queryInterface.sequelize.query(
          `SELECT "roleId" FROM "RolePermissions"
           WHERE "roleId" = :roleId AND "permissionId" = :permissionId LIMIT 1`,
          { replacements: { roleId: role.id, permissionId } },
        );
        if (link.length === 0) {
          await queryInterface.bulkInsert('RolePermissions', [
            {
              roleId: role.id,
              permissionId,
              createdAt: now,
              updatedAt: now,
            },
          ]);
        }
      }
    }
  },

  async down(queryInterface) {
    for (const key of PERMISSION_KEYS) {
      const [perms] = await queryInterface.sequelize.query(
        `SELECT id FROM permissions WHERE key = :key LIMIT 1`,
        { replacements: { key } },
      );
      if (perms.length === 0) continue;
      const permissionId = perms[0].id;
      await queryInterface.sequelize.query(
        `DELETE FROM "RolePermissions" WHERE "permissionId" = :permissionId`,
        { replacements: { permissionId } },
      );
      await queryInterface.bulkDelete('permissions', { key });
    }
  },
};
