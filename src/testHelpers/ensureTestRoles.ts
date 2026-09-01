import { Role } from '@database/models/role.model';
import { Permission } from '@database/models/permission.model';
import { sequelize } from '@database/models';
import { ROLES } from '@core/constants/statuses';
import { PERMISSION_KEYS, ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';

/**
 * Ensures baseline roles + permissions exist for integration tests.
 * Requires `db:migrate`. This is not a full seeder clone — it upserts keys used by tests.
 */
export async function ensureTestRoles(): Promise<void> {
  for (const name of Object.values(ROLES)) {
    await Role.findOrCreate({
      where: { name },
      defaults: { name, createdBy: null, updatedBy: null, deletedBy: null },
    });
  }

  const permIds: Record<string, string> = {};
  for (const key of PERMISSION_KEYS) {
    const [perm] = await Permission.findOrCreate({
      where: { key },
      defaults: { key, createdBy: null, updatedBy: null, deletedBy: null },
    });
    permIds[key] = perm.id;
  }

  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await Role.findOne({ where: { name: roleName } });
    if (!role) continue;
    for (const key of keys) {
      const permissionId = permIds[key];
      if (!permissionId) continue;
      const [existing] = (await sequelize.query(
        `SELECT "roleId" FROM "RolePermissions"
         WHERE "roleId" = :roleId AND "permissionId" = :permissionId
         LIMIT 1`,
        { replacements: { roleId: role.id, permissionId } },
      )) as [Array<{ roleId: string }>, unknown];
      if (existing.length > 0) continue;
      await sequelize.query(
        `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
         VALUES (:roleId, :permissionId, NOW(), NOW())`,
        { replacements: { roleId: role.id, permissionId } },
      );
    }
  }
}
