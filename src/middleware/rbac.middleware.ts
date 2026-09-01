import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { sequelize } from '@config/db';
import { QueryTypes } from 'sequelize';
import { PERMISSION_KEYS, type PermissionKey } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';

const rolePermissionCache = new Map<string, Set<string>>();

export async function loadPermissionsForRole(roleId: string): Promise<Set<string>> {
  const rows = await sequelize.query<{ key: string }>(
    `SELECT p.key from permissions p
     INNER JOIN "RolePermissions" rp ON rp."permissionId" = p.id
     WHERE rp."roleId" = :roleId`,
    { replacements: { roleId }, type: QueryTypes.SELECT },
  );
  const perms = new Set(rows.map((r) => r.key));
  rolePermissionCache.set(roleId, perms);
  return perms;
}

export async function resolvePermissionsForUser(user: {
  roleId: string;
  role: { name: string };
}): Promise<PermissionKey[]> {
  if (user.role.name === ROLES.SUPER_ADMIN) {
    return [...PERMISSION_KEYS];
  }
  let perms = rolePermissionCache.get(user.roleId);
  if (!perms) {
    perms = await loadPermissionsForRole(user.roleId);
  }
  return [...perms].filter((k): k is PermissionKey =>
    (PERMISSION_KEYS as readonly string[]).includes(k),
  );
}

/**
 * Require at least one of the given permission keys.
 * SUPER_ADMIN always passes.
 */
export const authorize = (...permissionKeys: PermissionKey[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED));
    }

    if (user.role.name === ROLES.SUPER_ADMIN) {
      return next();
    }

    if (permissionKeys.length === 0) {
      return next(new ForbiddenError(ERROR_MESSAGES.FORBIDDEN));
    }

    let perms = rolePermissionCache.get(user.roleId);
    if (!perms) {
      perms = await loadPermissionsForRole(user.roleId);
    }

    if (permissionKeys.some((key) => perms!.has(key))) {
      return next();
    }

    return next(new ForbiddenError(ERROR_MESSAGES.FORBIDDEN));
  };
};

export const clearPermissionCache = () => rolePermissionCache.clear();
export const setPermissionCache = (roleId: string, permissions: string[]) => {
  rolePermissionCache.set(roleId, new Set(permissions));
};
