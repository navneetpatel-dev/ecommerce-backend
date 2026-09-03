'use strict';

/**
 * Must match `src/core/permissions/permissionKeys.ts` PERMISSIONS values
 * (and ROLE_PERMISSIONS assignments). Keys stay as string arrays here since this is JS.
 *
 * Idempotent: safe to re-run on an already-seeded database.
 */

const { v4: uuidv4 } = require('uuid');

const ROLE_NAMES = [
  'SUPER_ADMIN',
  'ADMIN_ORDER_MANAGER',
  'ADMIN_CATALOG_MANAGER',
  'VENDOR_OWNER',
  'VENDOR_STAFF',
  'DELIVERY_AGENT',
  'CUSTOMER',
];

const PERMISSION_KEYS = [
  'user.manage', 'vendor.manage', 'vendor.approve', 'product.manage', 'product.approve',
  'category.manage', 'order.manage', 'order.refund', 'coupon.manage', 'commission.view',
  'payout.manage', 'review.moderate', 'tax.manage', 'shipping.manage', 'settings.manage',
  'banner.manage',
  'audit.view', 'analytics.view', 'product.create', 'product.update', 'product.delete',
  'suborder.manage', 'payout.view', 'review.respond',
  'ticket.manage', 'bug_report.manage', 'wallet.adjust',
  'delivery_agent.manage', 'shipment.delivery_update', 'return.pickup_update',
];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: PERMISSION_KEYS,
  ADMIN_ORDER_MANAGER: [
    'order.manage', 'order.refund', 'analytics.view', 'audit.view',
    'ticket.manage', 'bug_report.manage', 'wallet.adjust',
    'delivery_agent.manage',
  ],
  ADMIN_CATALOG_MANAGER: [
    'product.manage', 'product.approve', 'category.manage', 'banner.manage',
    'review.moderate', 'analytics.view', 'audit.view',
  ],
  VENDOR_OWNER: ['product.create', 'product.update', 'product.delete', 'suborder.manage', 'payout.view', 'review.respond'],
  VENDOR_STAFF: ['product.update', 'suborder.manage'],
  DELIVERY_AGENT: ['shipment.delivery_update', 'return.pickup_update'],
  CUSTOMER: [],
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const roleIds = {};

    for (const name of ROLE_NAMES) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM roles WHERE name = :name LIMIT 1`,
        { replacements: { name } },
      );
      if (existing.length > 0) {
        roleIds[name] = existing[0].id;
      } else {
        const id = uuidv4();
        roleIds[name] = id;
        await queryInterface.bulkInsert('roles', [
          { id, name, createdAt: now, updatedAt: now },
        ]);
      }
    }

    const permIds = {};
    for (const key of PERMISSION_KEYS) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM permissions WHERE key = :key LIMIT 1`,
        { replacements: { key } },
      );
      if (existing.length > 0) {
        permIds[key] = existing[0].id;
      } else {
        const id = uuidv4();
        permIds[key] = id;
        await queryInterface.bulkInsert('permissions', [
          { id, key, createdAt: now, updatedAt: now },
        ]);
      }
    }

    const rolePermEntries = [];
    for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleIds[roleName];
      for (const permKey of perms) {
        const permissionId = permIds[permKey];
        const [link] = await queryInterface.sequelize.query(
          `SELECT "roleId" FROM "RolePermissions"
           WHERE "roleId" = :roleId AND "permissionId" = :permissionId
           LIMIT 1`,
          { replacements: { roleId, permissionId } },
        );
        if (link.length === 0) {
          rolePermEntries.push({
            roleId,
            permissionId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
    if (rolePermEntries.length > 0) {
      await queryInterface.bulkInsert('RolePermissions', rolePermEntries);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('RolePermissions', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
  },
};
