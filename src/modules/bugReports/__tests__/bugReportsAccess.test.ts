import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { BugReport } from '@database/models';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { bugReportsService } from '../bugReports.service';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

let router: Router;
before(async () => {
  router = (await import('../bugReports.routes')).default;
});
afterEach(() => {
  clearPermissionCache();
  mock.restoreAll();
});

const layerFor = (method: string, path: string) => {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  return layer.route;
};

/** Runs the permission guard (2nd handler, right after `authenticate`) for a user holding `permissions`. */
async function guard(method: string, path: string, role: string, permissions: string[]): Promise<unknown> {
  const roleId = `role-${role}`;
  setPermissionCache(roleId, permissions);
  const req = { user: { id: 'u1', roleId, role: { name: role }, vendorId: null } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layerFor(method, path).stack[1]!.handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;
const permsOf = (role: string) => [...(ROLE_PERMISSIONS[role] ?? [])];

const ADMIN_QUEUE_ROUTES: [string, string][] = [
  ['get', '/admin'],
  ['post', '/:id/triage'],
  ['post', '/:id/assignment'],
  ['post', '/:id/status'],
  ['post', '/:id/duplicate'],
  ['post', '/:id/wont-fix'],
  ['post', '/:id/comments'],
  ['get', '/:id/comments'],
];

describe('the admin bug-report queue (all 8 routes) is Super Admin only', () => {
  for (const [method, path] of ADMIN_QUEUE_ROUTES) {
    it(`${method.toUpperCase()} /bug-reports${path}: Super Admin passes`, async () => {
      assert.equal(await guard(method, path, ROLES.SUPER_ADMIN, permsOf(ROLES.SUPER_ADMIN)), undefined);
    });

    it(`${method.toUpperCase()} /bug-reports${path}: vendors and customers get 403`, async () => {
      for (const role of [ROLES.VENDOR_OWNER, ROLES.CUSTOMER]) {
        assert.ok(forbidden(await guard(method, path, role, permsOf(role))), `${role} should get 403 on ${method} ${path}`);
      }
    });

  }
});

describe('everyone can still report bugs and follow their own', () => {
  it('POST / and GET /mine carry no permission guard (authenticate + validate/controller only)', () => {
    assert.equal(layerFor('post', '/').stack.length, 3);
    assert.equal(layerFor('get', '/mine').stack.length, 2);
  });
});

describe('BugReportsService.getById: only the reporter or a manager can read a report', () => {
  const bug = (reporterId: string) => ({ id: 'bug-1', reporterId });
  const actor = (id: string, role: string) => ({ id, vendorId: null, roleId: `role-${role}`, role: { name: role } });

  it('a customer cannot open someone else’s report either', async () => {
    setPermissionCache('role-CUSTOMER', []);
    mock.method(BugReport, 'findByPk', async () => bug('someone-else') as never);
    await assert.rejects(
      bugReportsService.getById('bug-1', actor('c-1', ROLES.CUSTOMER)),
      (e: { statusCode?: number }) => e.statusCode === 403,
    );
  });

  it('the reporter and the Super Admin are not refused (the access check passes)', async () => {
    mock.method(BugReport, 'findByPk', async () => bug('c-1') as never);
    setPermissionCache('role-CUSTOMER', []);
    setPermissionCache('role-SUPER_ADMIN', permsOf(ROLES.SUPER_ADMIN));
    for (const who of [actor('c-1', ROLES.CUSTOMER), actor('sa-1', ROLES.SUPER_ADMIN)]) {
      try {
        await bugReportsService.getById('bug-1', who);
      } catch (e) {
        // Anything after the access check needs a real row; only a 403 would be a failure here.
        assert.notEqual((e as { statusCode?: number }).statusCode, 403, `${who.role.name} must not be refused`);
      }
    }
  });
});
