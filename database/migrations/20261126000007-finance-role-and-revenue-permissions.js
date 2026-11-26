'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Moves the money-facing powers out of the two operations managers:
 *  - adds `analytics.revenue` (platform revenue figures) and `coupon.unlimited` (coupons beyond the
 *    standard discount ceilings), both granted to SUPER_ADMIN only, mirroring the roles seeder;
 *  - creates the built-in ADMIN_FINANCE_MANAGER role with payouts, commissions, revenue analytics,
 *    wallet adjustments, cashback offers and gift cards;
 *  - takes `gift_card.manage` (liability view and deactivation) off ADMIN_ORDER_MANAGER.
 * Fresh databases get all of it from the roles seeder. Safe to run again.
 */
const NEW_PERMISSIONS = ['analytics.revenue', 'coupon.unlimited'];
const FINANCE_ROLE = 'ADMIN_FINANCE_MANAGER';
const FINANCE_PERMISSIONS = [
  'payout.manage',
  'commission.view',
  'analytics.view',
  'analytics.revenue',
  'wallet.adjust',
  'cashback.manage',
  'gift_card.manage',
];

const GRANT_SQL = `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
  SELECT r.id, p.id, :now, :now
  FROM roles r, permissions p
  WHERE r.name = :role AND p.key IN (:keys)
    AND NOT EXISTS (
      SELECT 1 FROM "RolePermissions" rp WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
    )`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { transaction, replacements });

      for (const key of NEW_PERMISSIONS) {
        await q(
          `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
           SELECT :id, :key, :now, :now
           WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = :key)`,
          { id: randomUUID(), key, now },
        );
      }
      await q(GRANT_SQL, { now, role: 'SUPER_ADMIN', keys: NEW_PERMISSIONS });

      await q(
        `INSERT INTO roles (id, name, "createdAt", "updatedAt")
         SELECT :id, :role, :now, :now
         WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = :role)`,
        { id: randomUUID(), role: FINANCE_ROLE, now },
      );
      await q(GRANT_SQL, { now, role: FINANCE_ROLE, keys: FINANCE_PERMISSIONS });

      await q(
        `DELETE FROM "RolePermissions"
         WHERE "roleId" IN (SELECT id FROM roles WHERE name = 'ADMIN_ORDER_MANAGER')
           AND "permissionId" IN (SELECT id FROM permissions WHERE key = 'gift_card.manage')`,
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { transaction, replacements });

      await q(GRANT_SQL, { now, role: 'ADMIN_ORDER_MANAGER', keys: ['gift_card.manage'] });

      await q(`DELETE FROM "RolePermissions" WHERE "roleId" IN (SELECT id FROM roles WHERE name = :role)`, { role: FINANCE_ROLE });
      // A role that still has users cannot be dropped: leave it (empty) instead of failing the rollback.
      await q(
        `DELETE FROM roles WHERE name = :role AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = roles.id)`,
        { role: FINANCE_ROLE },
      );

      await q(
        `DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key IN (:keys))`,
        { keys: NEW_PERMISSIONS },
      );
      await q(`DELETE FROM permissions WHERE key IN (:keys)`, { keys: NEW_PERMISSIONS });
    });
  },
};
