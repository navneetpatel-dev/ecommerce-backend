'use strict';

const { randomUUID } = require('node:crypto');

/**
 * `gift_card.manage`: the admin gift card list, liability and deactivation. Granted to
 * ADMIN_ORDER_MANAGER (SUPER_ADMIN has every key). Fresh databases get it from the
 * roles seeder; this adds it to existing ones. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      const now = new Date();
      await run(
        `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
         SELECT :id, 'gift_card.manage', :now, :now
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'gift_card.manage')`,
        { id: randomUUID(), now },
      );
      await run(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         SELECT r.id, p.id, :now, :now
         FROM roles r, permissions p
         WHERE r.name = 'ADMIN_ORDER_MANAGER' AND p.key = 'gift_card.manage'
           AND NOT EXISTS (
             SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
           )`,
        { now },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = 'gift_card.manage');
       DELETE FROM permissions WHERE key = 'gift_card.manage';`,
    );
  },
};
