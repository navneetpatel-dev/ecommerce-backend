import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

let router: Router;
before(async () => {
  router = (await import('../returns.routes')).default;
});
afterEach(() => clearPermissionCache());

async function guard(method: string, path: string, role: string): Promise<unknown> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  setPermissionCache(`role-${role}`, [...(ROLE_PERMISSIONS[role] ?? [])]);
  const req = { user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: role.startsWith('VENDOR') ? 'v1' : null } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layer.route.stack[1]!.handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;

describe('vendor returns', () => {
  it('disputing a return and the debit note: the vendor and the Super Admin pass, customers do not', async () => {
    for (const [method, path] of [['post', '/:id/dispute'], ['get', '/:id/debit-note']] as const) {
      for (const role of [ROLES.VENDOR_OWNER, ROLES.SUPER_ADMIN]) assert.equal(await guard(method, path, role), undefined, role);
      assert.ok(forbidden(await guard(method, path, ROLES.CUSTOMER)), `${method} ${path}`);
    }
  });

  it('restocking and listing the store’s returns stay open to the vendor', async () => {
    assert.equal(await guard('post', '/:id/restock', ROLES.VENDOR_OWNER), undefined);
    assert.equal(await guard('get', '/vendor/me', ROLES.VENDOR_OWNER), undefined);
  });

  it('resolving a dispute and refunds stay with the platform', async () => {
    for (const path of ['/:id/resolve-dispute', '/:id/retry-refund']) {
      assert.equal(await guard('post', path, ROLES.SUPER_ADMIN), undefined, path);
      assert.ok(forbidden(await guard('post', path, ROLES.VENDOR_OWNER)), path);
    }
  });
});
