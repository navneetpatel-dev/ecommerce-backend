import { Role } from '@database/models/role.model';
import { Permission } from '@database/models/permission.model';
import { User } from '@database/models/user.model';
import { sequelize } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ROLE_VALUES } from '@core/constants/statuses';
import { clearPermissionCache } from '@middleware/rbac.middleware';
import type { CreateRoleRequest, UpdateRoleRequest, SetRolePermissionsRequest } from './roles.dto';

/** The 7 seeded role names are checked by string identity all over the codebase
 * (SUPER_ADMIN bypass, ADMIN_ROLES/VENDOR_ROLES membership, etc.) — renaming or
 * deleting one would silently break auth elsewhere, so both are blocked here. */
const SYSTEM_ROLE_NAMES = new Set<string>(ROLE_VALUES);

interface SerializedRole {
  id: string;
  name: string;
  isSystemRole: boolean;
  permissionKeys: string[];
  createdAt: Date;
}

function serializeRole(role: Role & { Permissions?: Permission[] }): SerializedRole {
  return {
    id: role.id,
    name: role.name,
    isSystemRole: SYSTEM_ROLE_NAMES.has(role.name),
    permissionKeys: (role.Permissions ?? []).map((p) => p.key),
    createdAt: role.createdAt as Date,
  };
}

export class RolesService {
  async list(): Promise<SerializedRole[]> {
    const roles = await Role.findAll({
      include: [{ model: Permission, attributes: ['id', 'key'] }],
      order: [['name', 'ASC']],
    });
    return roles.map((r) => serializeRole(r as Role & { Permissions?: Permission[] }));
  }

  async listAvailablePermissions(): Promise<Array<{ id: string; key: string }>> {
    const permissions = await Permission.findAll({ order: [['key', 'ASC']] });
    return permissions.map((p) => ({ id: p.id, key: p.key }));
  }

  async create(data: CreateRoleRequest): Promise<SerializedRole> {
    const existing = await Role.findOne({ where: { name: data.name } });
    if (existing) {
      throw new ValidationError({ name: ['A role with this name already exists'] });
    }
    const role = await Role.create({ name: data.name });
    return serializeRole(role as Role & { Permissions?: Permission[] });
  }

  async update(id: string, data: UpdateRoleRequest): Promise<SerializedRole> {
    const role = await Role.findByPk(id);
    if (!role) throw new NotFoundError('Role');
    if (SYSTEM_ROLE_NAMES.has(role.name)) {
      throw new ValidationError({ name: ['Built-in roles cannot be renamed'] });
    }
    const existing = await Role.findOne({ where: { name: data.name } });
    if (existing && existing.id !== id) {
      throw new ValidationError({ name: ['A role with this name already exists'] });
    }
    await role.update({ name: data.name });
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const role = await Role.findByPk(id);
    if (!role) throw new NotFoundError('Role');
    if (SYSTEM_ROLE_NAMES.has(role.name)) {
      throw new ValidationError({ role: ['Built-in roles cannot be deleted'] });
    }
    const usersWithRole = await User.count({ where: { roleId: id } });
    if (usersWithRole > 0) {
      throw new ValidationError({
        role: [`${usersWithRole} user(s) still have this role — reassign them first`],
      });
    }
    await sequelize.transaction(async (t) => {
      await (role as any).setPermissions([], { transaction: t });
      await role.destroy({ transaction: t });
    });
    clearPermissionCache();
  }

  async setPermissions(id: string, data: SetRolePermissionsRequest): Promise<SerializedRole> {
    const role = await Role.findByPk(id);
    if (!role) throw new NotFoundError('Role');

    const permissions = await Permission.findAll({ where: { key: data.permissionKeys } });
    const foundKeys = new Set(permissions.map((p) => p.key));
    const unknown = data.permissionKeys.filter((k) => !foundKeys.has(k));
    if (unknown.length > 0) {
      throw new ValidationError({ permissionKeys: [`Unknown permission key(s): ${unknown.join(', ')}`] });
    }

    await sequelize.transaction(async (t) => {
      await (role as any).setPermissions(permissions, { transaction: t });
    });
    clearPermissionCache();
    return this.getById(id);
  }

  private async getById(id: string): Promise<SerializedRole> {
    const role = await Role.findByPk(id, {
      include: [{ model: Permission, attributes: ['id', 'key'] }],
    });
    if (!role) throw new NotFoundError('Role');
    return serializeRole(role as Role & { Permissions?: Permission[] });
  }
}

export const rolesService = new RolesService();
