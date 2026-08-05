import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { sequelize } from '@config/db';
import { QueryTypes } from 'sequelize';

const rolePermissionCache = new Map<string, Set<string>>();

async function loadPermissionsForRole(roleId: string): Promise<Set<string>> {
  const rows = await sequelize.query<{ key: string }>(
    `SELECT p.key FROM permissions p
     INNER JOIN "RolePermissions" rp ON rp."permissionId" = p.id
     WHERE rp."roleId" = :roleId`,
    { replacements: { roleId }, type: QueryTypes.SELECT },
  );
  const perms = new Set(rows.map((r) => r.key));
  rolePermissionCache.set(roleId, perms);
  return perms;
}

export const authorize = (permissionKey: string) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError('Authentication required'));
    }

    if (user.role.name === 'SUPER_ADMIN') {
      return next();
    }

    let perms = rolePermissionCache.get(user.roleId);
    if (!perms) {
      perms = await loadPermissionsForRole(user.roleId);
    }

    if (perms.has(permissionKey)) {
      return next();
    }

    return next(new ForbiddenError(`Missing permission: ${permissionKey}`));
  };
};

export const clearPermissionCache = () => rolePermissionCache.clear();
export const setPermissionCache = (roleId: string, permissions: string[]) => {
  rolePermissionCache.set(roleId, new Set(permissions));
};
