'use strict';

const { v4: uuidv4 } = require('uuid');

/** Adds banner.manage permission for existing databases (fresh installs get it via roles seeder). */

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE key = 'banner.manage' LIMIT 1`,
    );
    let permissionId;
    if (existing.length > 0) {
      permissionId = existing[0].id;
    } else {
      permissionId = uuidv4();
      await queryInterface.bulkInsert('permissions', [
        { id: permissionId, key: 'banner.manage', createdAt: now, updatedAt: now },
      ]);
    }

    const [roles] = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles WHERE name IN ('SUPER_ADMIN', 'ADMIN_CATALOG_MANAGER')`,
    );

    for (const role of roles) {
      const [link] = await queryInterface.sequelize.query(
        `SELECT "roleId" FROM "RolePermissions" WHERE "roleId" = :roleId AND "permissionId" = :permissionId LIMIT 1`,
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
  },

  async down(queryInterface) {
    const [perms] = await queryInterface.sequelize.query(
      `SELECT id FROM permissions WHERE key = 'banner.manage' LIMIT 1`,
    );
    if (perms.length === 0) return;
    const permissionId = perms[0].id;
    await queryInterface.sequelize.query(
      `DELETE FROM "RolePermissions" WHERE "permissionId" = :permissionId`,
      { replacements: { permissionId } },
    );
    await queryInterface.bulkDelete('permissions', { key: 'banner.manage' });
  },
};
