'use strict';

const { v4: uuidv4 } = require('uuid');

const ROLE_NAME = 'DELIVERY_AGENT';
const DELIVERY_PERMISSIONS = [
  'delivery_agent.manage',
  'shipment.delivery_update',
  'return.pickup_update',
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const [existingRoles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLE_NAME } },
    );
    const roleId = existingRoles[0]?.id ?? uuidv4();
    if (!existingRoles.length) {
      await queryInterface.bulkInsert('roles', [
        { id: roleId, name: ROLE_NAME, createdAt: now, updatedAt: now },
      ]);
    }

    const permissionIds = {};
    for (const key of DELIVERY_PERMISSIONS) {
      const [existingPermissions] = await queryInterface.sequelize.query(
        'SELECT id FROM permissions WHERE key = :key LIMIT 1',
        { replacements: { key } },
      );
      const permissionId = existingPermissions[0]?.id ?? uuidv4();
      permissionIds[key] = permissionId;
      if (!existingPermissions.length) {
        await queryInterface.bulkInsert('permissions', [
          { id: permissionId, key, createdAt: now, updatedAt: now },
        ]);
      }
    }

    const [orderManagerRoles] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE name = 'ADMIN_ORDER_MANAGER' LIMIT 1`,
    );
    const assignments = [
      [roleId, permissionIds['shipment.delivery_update']],
      [roleId, permissionIds['return.pickup_update']],
      [orderManagerRoles[0]?.id, permissionIds['delivery_agent.manage']],
    ].filter(([assignedRoleId]) => Boolean(assignedRoleId));

    for (const [assignedRoleId, permissionId] of assignments) {
      const [existingLinks] = await queryInterface.sequelize.query(
        `SELECT "roleId" FROM "RolePermissions"
         WHERE "roleId" = :roleId AND "permissionId" = :permissionId
         LIMIT 1`,
        { replacements: { roleId: assignedRoleId, permissionId } },
      );
      if (!existingLinks.length) {
        await queryInterface.bulkInsert('RolePermissions', [
          { roleId: assignedRoleId, permissionId, createdAt: now, updatedAt: now },
        ]);
      }
    }
  },

  async down(queryInterface) {
    const [roles] = await queryInterface.sequelize.query(
      'SELECT id FROM roles WHERE name = :name LIMIT 1',
      { replacements: { name: ROLE_NAME } },
    );
    const [permissions] = await queryInterface.sequelize.query(
      'SELECT id, key FROM permissions WHERE key IN (:keys)',
      { replacements: { keys: DELIVERY_PERMISSIONS } },
    );
    const permissionIds = permissions.map((permission) => permission.id);
    if (permissionIds.length) {
      await queryInterface.bulkDelete('RolePermissions', { permissionId: permissionIds }, {});
    }
    if (roles[0]?.id) {
      await queryInterface.bulkDelete('roles', { id: roles[0].id }, {});
    }
    await queryInterface.bulkDelete('permissions', { key: DELIVERY_PERMISSIONS }, {});
  },
};
