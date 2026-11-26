import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../permissionKeys';
import { ROLES } from '@core/constants/statuses';

const requireJs = createRequire(__filename);
const dbDir = path.resolve(__dirname, '../../../../database');

describe('audit.view is Super Admin only', () => {
  it('no built-in role except Super Admin holds it', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const has = perms.includes(PERMISSIONS.AUDIT_VIEW);
      assert.equal(has, role === ROLES.SUPER_ADMIN, `${role} audit.view should be ${role === ROLES.SUPER_ADMIN}`);
    }
  });

  it('managers keep the rest of their grants (only audit.view was removed)', () => {
    assert.ok(ROLE_PERMISSIONS[ROLES.ADMIN_ORDER_MANAGER].includes(PERMISSIONS.ANALYTICS_VIEW));
    assert.ok(ROLE_PERMISSIONS[ROLES.ADMIN_ORDER_MANAGER].includes(PERMISSIONS.ORDER_MANAGE));
    assert.ok(ROLE_PERMISSIONS[ROLES.ADMIN_CATALOG_MANAGER].includes(PERMISSIONS.ANALYTICS_VIEW));
    assert.ok(ROLE_PERMISSIONS[ROLES.ADMIN_CATALOG_MANAGER].includes(PERMISSIONS.PRODUCT_MANAGE));
  });
});

describe('GET /api/audit guard', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/audit/audit.routes')).default;
  });

  async function outcomeFor(role: string, permissions: string[]): Promise<unknown> {
    clearPermissionCache();
    const layer = (router as unknown as { stack: { route?: { path: string; stack: { handle: (...a: unknown[]) => unknown }[] } }[] }).stack.find(
      (l) => l.route?.path === '/',
    );
    assert.ok(layer?.route);
    setPermissionCache(`role-${role}`, permissions);
    const req = { user: { roleId: `role-${role}`, role: { name: role } } } as unknown as Request;
    let outcome: unknown = 'not-called';
    await layer.route.stack[1].handle(req, {} as Response, ((err?: unknown) => {
      outcome = err;
    }) as NextFunction);
    return outcome;
  }

  it('lets Super Admin and an explicit audit.view custom role through', async () => {
    assert.equal(await outcomeFor(ROLES.SUPER_ADMIN, []), undefined);
    assert.equal(await outcomeFor('AUDITOR', ['audit.view', 'analytics.view']), undefined);
  });

  it('returns 403 for managers, vendors and customers', async () => {
    for (const role of [
      ROLES.ADMIN_ORDER_MANAGER,
      ROLES.ADMIN_CATALOG_MANAGER,
      ROLES.VENDOR_OWNER,
      ROLES.VENDOR_STAFF,
      ROLES.CUSTOMER,
    ]) {
      const outcome = await outcomeFor(role, [...(ROLE_PERMISSIONS[role] ?? [])]);
      assert.equal((outcome as { statusCode?: number } | undefined)?.statusCode, 403, `${role} should get 403`);
    }
  });
});

describe('20261126000002-revoke-manager-audit-view migration (SQL shape, not run against Postgres)', () => {
  const migration = requireJs(path.join(dbDir, 'migrations/20261126000002-revoke-manager-audit-view.js'));
  const run = async (direction: 'up' | 'down') => {
    const calls: { sql: string; replacements: Record<string, unknown> }[] = [];
    await migration[direction]({
      sequelize: {
        query: async (sql: string, opts: { replacements: Record<string, unknown> }) => {
          calls.push({ sql, replacements: opts.replacements });
          return [[]];
        },
      },
    });
    return calls;
  };

  it('up: deletes audit.view only for the two manager roles', async () => {
    const [call, ...rest] = await run('up');
    assert.equal(rest.length, 0);
    assert.match(call.sql, /DELETE FROM "RolePermissions"/);
    assert.match(call.sql, /key = 'audit\.view'/);
    assert.deepEqual(call.replacements.roles, ['ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER']);
    assert.doesNotMatch(call.sql, /SUPER_ADMIN|AUDITOR/);
  });

  it('down: re-grants idempotently to the same two roles', async () => {
    const [call] = await run('down');
    assert.match(call.sql, /INSERT INTO "RolePermissions"/);
    assert.match(call.sql, /NOT EXISTS/);
    assert.deepEqual(call.replacements.roles, ['ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER']);
  });
});
