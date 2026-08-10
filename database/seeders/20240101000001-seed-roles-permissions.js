'use strict';

/**
 * Must match `src/core/permissions/permissionKeys.ts` PERMISSIONS values
 * (and ROLE_PERMISSIONS assignments). Keys stay as string arrays here since this is JS.
 */

const { v4: uuidv4 } = require('uuid');

const ROLE_IDS = {
  SUPER_ADMIN: uuidv4(),
  ADMIN_ORDER_MANAGER: uuidv4(),
  ADMIN_CATALOG_MANAGER: uuidv4(),
  VENDOR_OWNER: uuidv4(),
  VENDOR_STAFF: uuidv4(),
  CUSTOMER: uuidv4(),
};

const PERMISSION_KEYS = [
  'user.manage', 'vendor.manage', 'vendor.approve', 'product.manage', 'product.approve',
  'category.manage', 'order.manage', 'order.refund', 'coupon.manage', 'commission.view',
  'payout.manage', 'review.moderate', 'tax.manage', 'shipping.manage', 'settings.manage',
  'banner.manage',
  'audit.view', 'analytics.view', 'product.create', 'product.update', 'product.delete',
  'suborder.manage', 'payout.view', 'review.respond',
];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: PERMISSION_KEYS,
  ADMIN_ORDER_MANAGER: ['order.manage', 'order.refund', 'analytics.view', 'audit.view'],
  ADMIN_CATALOG_MANAGER: [
    'product.manage', 'product.approve', 'category.manage', 'banner.manage',
    'review.moderate', 'analytics.view', 'audit.view',
  ],
  VENDOR_OWNER: ['product.create', 'product.update', 'product.delete', 'suborder.manage', 'payout.view', 'review.respond'],
  VENDOR_STAFF: ['product.update', 'suborder.manage'],
  CUSTOMER: [],
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('roles', [
      { id: ROLE_IDS.SUPER_ADMIN, name: 'SUPER_ADMIN', createdAt: now, updatedAt: now },
      { id: ROLE_IDS.ADMIN_ORDER_MANAGER, name: 'ADMIN_ORDER_MANAGER', createdAt: now, updatedAt: now },
      { id: ROLE_IDS.ADMIN_CATALOG_MANAGER, name: 'ADMIN_CATALOG_MANAGER', createdAt: now, updatedAt: now },
      { id: ROLE_IDS.VENDOR_OWNER, name: 'VENDOR_OWNER', createdAt: now, updatedAt: now },
      { id: ROLE_IDS.VENDOR_STAFF, name: 'VENDOR_STAFF', createdAt: now, updatedAt: now },
      { id: ROLE_IDS.CUSTOMER, name: 'CUSTOMER', createdAt: now, updatedAt: now },
    ]);

    const permIds = {};
    for (const key of PERMISSION_KEYS) {
      permIds[key] = uuidv4();
      await queryInterface.bulkInsert('permissions', [{ 
        id: permIds[key], 
        key,
        createdAt: now,
        updatedAt: now
      }]);
    }

    const rolePermEntries = [];
    for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permKey of perms) {
        rolePermEntries.push({
          roleId: ROLE_IDS[roleName],
          permissionId: permIds[permKey],
          createdAt: now,
          updatedAt: now,
        });
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
