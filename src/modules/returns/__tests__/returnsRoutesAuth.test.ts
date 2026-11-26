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

describe('vendor returns: staff run the warehouse, owners run the money', () => {
  it('disputing a return: the store owner and platform refund staff pass; vendor staff do not', async () => {
    for (const role of [ROLES.VENDOR_OWNER, ROLES.ADMIN_ORDER_MANAGER, ROLES.SUPER_ADMIN]) {
      assert.equal(await guard('post', '/:id/dispute', role), undefined, role);
    }
    for (const role of [ROLES.VENDOR_STAFF, ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.CUSTOMER]) {
      assert.ok(forbidden(await guard('post', '/:id/dispute', role)), `${role} should get 403`);
    }
  });

  it('the debit note (a financial document): owner and refund staff pass; vendor staff do not', async () => {
    for (const role of [ROLES.VENDOR_OWNER, ROLES.ADMIN_ORDER_MANAGER, ROLES.SUPER_ADMIN]) {
      assert.equal(await guard('get', '/:id/debit-note', role), undefined, role);
    }
    assert.ok(forbidden(await guard('get', '/:id/debit-note', ROLES.VENDOR_STAFF)));
  });

  it('restocking and listing the store’s returns stay open to vendor staff (no regression)', async () => {
    for (const role of [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF]) {
      assert.equal(await guard('post', '/:id/restock', role), undefined, `restock ${role}`);
      assert.equal(await guard('get', '/vendor/me', role), undefined, `list ${role}`);
    }
  });

  it('resolving a dispute and refunds stay with platform refund staff only', async () => {
    for (const path of ['/:id/resolve-dispute', '/:id/retry-refund']) {
      assert.equal(await guard('post', path, ROLES.ADMIN_ORDER_MANAGER), undefined, path);
      for (const role of [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF]) assert.ok(forbidden(await guard('post', path, role)), `${role} ${path}`);
    }
  });
});
