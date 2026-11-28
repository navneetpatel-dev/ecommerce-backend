import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { requireVendorContext } from '../vendorContext.middleware';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

let router: Router;

before(async () => {
  router = (await import('../vendors.routes')).default;
});

afterEach(() => clearPermissionCache());

/** Runs the permission guard (2nd handler, right after `authenticate`) of a route for a given role. */
async function guardResult(method: string, path: string, role: string): Promise<unknown> {
  return runGuard(method, path, role, [...(ROLE_PERMISSIONS[role] ?? [])]);
}

/** Same, for someone holding exactly `permissions`. */
async function guardResultWith(method: string, path: string, permissions: string[]): Promise<unknown> {
  return runGuard(method, path, 'PERMISSION_PROBE', permissions);
}

async function runGuard(method: string, path: string, role: string, permissions: string[]): Promise<unknown> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  const roleId = `role-${role}`;
  setPermissionCache(roleId, permissions);
  const req = { user: { roleId, role: { name: role }, vendorId: 'v1' } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layer.route.stack[1].handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const forbidden = (outcome: unknown) =>
  (outcome as { statusCode?: number } | undefined)?.statusCode === 403;

describe('vendor store-profile writes', () => {
  for (const [method, path] of [
    ['patch', '/me'],
    ['post', '/me/documents'],
  ] as const) {
    it(`${method.toUpperCase()} ${path}: the vendor and the Super Admin pass, customers do not`, async () => {
      assert.equal(await guardResult(method, path, ROLES.VENDOR_OWNER), undefined);
      assert.equal(await guardResult(method, path, ROLES.SUPER_ADMIN), undefined);
      assert.ok(forbidden(await guardResult(method, path, ROLES.CUSTOMER)));
    });
  }
});

describe('vendor store reads', () => {
  for (const path of ['/me', '/dashboard/summary', '/dashboard/analytics', '/me/documents', '/me/kyc-checklist']) {
    it(`GET ${path}: the vendor and the Super Admin pass, customers do not`, async () => {
      assert.equal(await guardResult('get', path, ROLES.VENDOR_OWNER), undefined);
      assert.equal(await guardResult('get', path, ROLES.SUPER_ADMIN), undefined);
      assert.ok(forbidden(await guardResult('get', path, ROLES.CUSTOMER)));
    });
  }
});

describe('KYC document view-url', () => {
  const path = '/documents/:documentId/view-url';

  it('the vendor, and anyone holding vendor.manage / vendor.approve, passes', async () => {
    assert.equal(await guardResult('get', path, ROLES.VENDOR_OWNER), undefined);
    assert.equal(await guardResultWith('get', path, ['vendor.manage']), undefined);
    assert.equal(await guardResultWith('get', path, ['vendor.approve']), undefined);
  });

  it('customers are forbidden', async () => {
    assert.ok(forbidden(await guardResult('get', path, ROLES.CUSTOMER)));
  });
});

describe('every /vendors/me* and vendor-dashboard route requires a store (requireVendorContext)', () => {
  const routes: [string, string][] = [
    ['get', '/dashboard/summary'],
    ['get', '/dashboard/analytics'],
    ['get', '/me'],
    ['patch', '/me'],
    ['get', '/me/documents'],
    ['post', '/me/documents'],
    ['get', '/me/kyc-checklist'],
  ];

  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path} runs requireVendorContext after its permission guard`, () => {
      const layer = (router as unknown as { stack: Layer[] }).stack.find(
        (l) => l.route?.path === path && l.route.methods[method],
      );
      const names = layer!.route!.stack.map((h) => h.handle.name);
      const ctxIdx = names.indexOf('requireVendorContext');
      assert.ok(ctxIdx > 1, `${method} ${path} is missing requireVendorContext (handlers: ${names.join(', ')})`);
    });
  }

  it('the middleware answers 403 VENDOR_NOT_LINKED without a vendorId and passes with one', () => {
    const run = (user: unknown) => {
      let outcome: unknown = 'not-called';
      requireVendorContext({ user } as Request, {} as Response, ((err?: unknown) => {
        outcome = err;
      }) as NextFunction);
      return outcome as { statusCode?: number; message?: string } | undefined;
    };
    for (const user of [{ vendorId: null }, { vendorId: undefined }, undefined]) {
      const outcome = run(user);
      assert.equal(outcome?.statusCode, 403);
      assert.match(outcome?.message ?? '', /No vendor profile is linked/);
    }
    assert.equal(run({ vendorId: 'v1' }), undefined);
  });
});
