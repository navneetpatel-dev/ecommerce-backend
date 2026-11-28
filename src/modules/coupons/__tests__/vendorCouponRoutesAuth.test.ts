import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { ROLES } from '@core/constants/statuses';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

let router: Router;

before(async () => {
  router = (await import('../coupons.routes')).default;
});

/** Runs the guard right after `authenticate` (2nd handler) for a vendor coupon route. */
function guard(method: string, path: string, role: string, vendorId: string | null = 'v1'): unknown {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  let outcome: unknown = 'not-called';
  layer.route.stack[1].handle({ user: { role: { name: role }, vendorId } } as unknown as Request, {} as Response, ((
    err?: unknown,
  ) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;

const VENDOR_COUPON_ROUTES: [string, string][] = [
  ['get', '/vendor'],
  ['get', '/vendor/absorbed-summary'],
  ['get', '/vendor/:id'],
  ['get', '/vendor/:id/analytics'],
  ['post', '/vendor'],
  ['patch', '/vendor/:id'],
  ['patch', '/vendor/:id/status'],
];

describe('vendor store coupons are owner-only (reads and writes)', () => {
  for (const [method, path] of VENDOR_COUPON_ROUTES) {
    it(`${method.toUpperCase()} /coupons${path}: owner passes`, () => {
      assert.equal(guard(method, path, ROLES.VENDOR_OWNER), undefined);
    });

    it(`${method.toUpperCase()} /coupons${path}: customers get 403`, () => {
      for (const role of [ROLES.CUSTOMER]) {
        assert.ok(forbidden(guard(method, path, role)), `${role} should get 403 on ${method} ${path}`);
      }
    });

    it(`${method.toUpperCase()} /coupons${path}: an owner role without a store gets 403`, () => {
      assert.ok(forbidden(guard(method, path, ROLES.VENDOR_OWNER, null)));
    });
  }

  it('admin coupon routes still require coupon.manage (unchanged)', () => {
    const adminList = (router as unknown as { stack: Layer[] }).stack.find(
      (l) => l.route?.path === '/' && l.route.methods.get,
    );
    assert.ok(adminList?.route);
    assert.notEqual(adminList.route.stack[1].handle.name, 'requireVendorOwner');
  });
});
