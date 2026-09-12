import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { sequelize } from '@config/db';
import { QueryTypes } from 'sequelize';
import { redisClient, withRedis } from '@config/redis';
import { PERMISSION_KEYS, type PermissionKey } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';

const rolePermissionCache = new Map<string, Set<string>>();

/**
 * Cluster-wide cache invalidation: a bare in-process Map has no way to learn that ANOTHER
 * instance revoked or changed a role's permissions. In a horizontally-scaled deployment, an
 * emergency permission revocation (e.g. pulling a permission off a compromised custom role) must
 * actually take effect everywhere immediately — not just on whichever instance served the admin's
 * request, with every other instance still honoring the old, more-permissive set until it happens
 * to restart. Subscribe every instance to a Redis pub/sub channel so a local `clearPermissionCache`
 * call fans out and clears every other instance's local cache too.
 */
const ROLE_PERMISSION_INVALIDATE_CHANNEL = 'rbac:role-permission-cache:invalidate';

const roleCacheSubscriber = redisClient.duplicate();
roleCacheSubscriber.on('error', () => {});
roleCacheSubscriber.on('message', (channel: string) => {
  if (channel === ROLE_PERMISSION_INVALIDATE_CHANNEL) {
    rolePermissionCache.clear();
  }
});
void (async () => {
  try {
    if (roleCacheSubscriber.status === 'wait' || roleCacheSubscriber.status === 'end') {
      await roleCacheSubscriber.connect();
    }
    await roleCacheSubscriber.subscribe(ROLE_PERMISSION_INVALIDATE_CHANNEL);
  } catch {
    // Redis unavailable — falls back to the previous per-process-only behavior rather than
    // blocking startup; connectRedis() elsewhere already logs this condition once.
  }
})();

// The live server never sees this fire — its HTTP listener keeps the event loop busy for the
// whole process lifetime, and its own shutdown path force-exits via `process.exit()` regardless
// of open sockets. `beforeExit` only fires when Node's event loop would otherwise have nothing
// left to do, which is exactly the short-lived-test-process case: `node --test` runs each test
// file in its own subprocess, and this subscriber's open Redis connection would otherwise be the
// one thing left keeping that subprocess alive after its tests finish.
process.once('beforeExit', () => {
  roleCacheSubscriber.disconnect();
});

function broadcastPermissionCacheInvalidation() {
  void withRedis(() => redisClient.publish(ROLE_PERMISSION_INVALIDATE_CHANNEL, '1'));
}

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
  roleId?: string;
  role: { name: string };
}): Promise<PermissionKey[]> {
  if (user.role.name === ROLES.SUPER_ADMIN) {
    return [...PERMISSION_KEYS];
  }
  if (!user.roleId) {
    return [];
  }
  let perms = rolePermissionCache.get(user.roleId);
  if (!perms) {
    perms = await loadPermissionsForRole(user.roleId);
  }
  return [...perms].filter((k): k is PermissionKey =>
    (PERMISSION_KEYS as readonly string[]).includes(k),
  );
}

export async function userHasPermission(
  user: { roleId?: string; role: { name: string } } | undefined | null,
  ...permissionKeys: PermissionKey[]
): Promise<boolean> {
  if (!user) return false;
  if (user.role.name === ROLES.SUPER_ADMIN) return true;
  const perms = await resolvePermissionsForUser(user);
  return permissionKeys.some((k) => perms.includes(k));
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

export const clearPermissionCache = () => {
  rolePermissionCache.clear();
  broadcastPermissionCacheInvalidation();
};
/**
 * Test-only helper to seed the local cache directly, bypassing the DB query — NOT the production
 * invalidation signal (that's `clearPermissionCache`, called after a real permission change).
 * Deliberately does not broadcast: it populates a value rather than invalidating one, and
 * broadcasting here would make every real instance's cache-warm-on-miss (if ever wired through
 * this function instead of the private `rolePermissionCache.set` in `loadPermissionsForRole`)
 * clear every other instance's cache on every miss.
 */
export const setPermissionCache = (roleId: string, permissions: string[]) => {
  rolePermissionCache.set(roleId, new Set(permissions));
};
