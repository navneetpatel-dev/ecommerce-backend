import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from '../permissionKeys';
import { ADMIN_ROLES, ROLES, ROLE_LABELS, ROLE_VALUES, VENDOR_ROLES } from '@core/constants/statuses';

const requireJs = createRequire(__filename);
const seedersDir = path.resolve(__dirname, '../../../../database/seeders');

const VENDOR_PERMISSIONS = [
  'product.create',
  'product.update',
  'product.delete',
  'suborder.manage',
  'payout.view',
  'review.respond',
];

describe('the platform has exactly three roles', () => {
  it('Super Admin, Vendor and Customer, with those labels', () => {
    assert.deepEqual([...ROLE_VALUES].sort(), ['CUSTOMER', 'SUPER_ADMIN', 'VENDOR_OWNER']);
    assert.deepEqual(ROLE_LABELS, { SUPER_ADMIN: 'Super Admin', VENDOR_OWNER: 'Vendor', CUSTOMER: 'Customer' });
    assert.deepEqual([...ADMIN_ROLES], ['SUPER_ADMIN']);
    assert.deepEqual([...VENDOR_ROLES], ['VENDOR_OWNER']);
    assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...ROLE_VALUES].sort());
  });

  it('the Super Admin holds every permission, the vendor its six, the customer none', () => {
    assert.deepEqual([...ROLE_PERMISSIONS[ROLES.SUPER_ADMIN]!].sort(), [...PERMISSION_KEYS].sort());
    assert.deepEqual([...ROLE_PERMISSIONS[ROLES.VENDOR_OWNER]!].sort(), [...VENDOR_PERMISSIONS].sort());
    assert.deepEqual(ROLE_PERMISSIONS[ROLES.CUSTOMER], []);
  });

  it('the permissions that only separated the old roles are gone', () => {
    for (const key of ['role.manage', 'team.manage', 'coupon.unlimited', 'analytics.revenue']) {
      assert.equal((PERMISSION_KEYS as string[]).includes(key), false, key);
    }
  });

  it('the roles seeder writes exactly what the code defines', async () => {
    const seeder = requireJs(path.join(seedersDir, '20240101000001-seed-roles-permissions.js'));
    const inserted: Record<string, Array<Record<string, string>>> = {};
    await seeder.up({
      sequelize: { query: async () => [[]] },
      bulkInsert: async (table: string, rows: Array<Record<string, string>>) => {
        (inserted[table] ??= []).push(...rows);
      },
    });
    const roleName = new Map(inserted.roles!.map((row) => [row.id, row.name]));
    const key = new Map(inserted.permissions!.map((row) => [row.id, row.key]));
    assert.deepEqual([...roleName.values()].sort(), [...ROLE_VALUES].sort());
    assert.deepEqual([...key.values()].sort(), [...PERMISSION_KEYS].sort());
    for (const role of ROLE_VALUES) {
      const granted = inserted.RolePermissions!.filter((row) => roleName.get(row.roleId!) === role).map((row) => key.get(row.permissionId!));
      assert.deepEqual(granted.sort(), [...ROLE_PERMISSIONS[role]!].sort(), role);
    }
  });
});

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: (...a: unknown[]) => unknown }[] };
};

const permsOf = (role: string) => [...(ROLE_PERMISSIONS[role] ?? [])];
const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;
const layersOf = (router: Router) => (router as unknown as { stack: Layer[] }).stack;

async function router(file: string): Promise<Router> {
  return (await import(file)).default as Router;
}

/** Runs the permission guard (2nd handler, right after `authenticate`) as that role. */
async function guard(file: string, method: string, route: string, role: string): Promise<unknown> {
  const layer = layersOf(await router(file)).find((l) => l.route?.path === route && l.route.methods[method]);
  assert.ok(layer?.route, `route ${method} ${route} not found in ${file}`);
  const roleId = `role-${role}`;
  setPermissionCache(roleId, permsOf(role));
  const req = { user: { id: 'u1', roleId, role: { name: role }, vendorId: role === ROLES.VENDOR_OWNER ? 'v1' : null } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layer.route.stack[1]!.handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

describe('who passes each permission guard', () => {
  afterEach(() => clearPermissionCache());

  const adminOnly: Array<[string, string, string]> = [
    ['@modules/wallet/wallet.admin.routes', 'post', '/:userId/adjust'],
    ['@modules/cashbackOffers/cashbackOffers.routes', 'get', '/'],
    ['@modules/cashbackOffers/cashbackOffers.routes', 'post', '/'],
    ['@modules/webVitals/webVitals.routes', 'get', '/summary'],
    ['@modules/audit/audit.routes', 'get', '/'],
    ['@modules/giftCards/giftCards.routes', 'get', '/admin'],
    ['@modules/giftCards/giftCards.routes', 'get', '/admin/liability'],
    ['@modules/giftCards/giftCards.routes', 'post', '/admin/:id/cancel'],
    ['@modules/payouts/payouts.routes', 'post', '/process'],
    ['@modules/payouts/payouts.routes', 'patch', '/:id/mark-paid'],
    ['@modules/admin/admin.routes', 'get', '/dashboard'],
    ['@modules/admin/admin.routes', 'get', '/analytics/platform'],
    ['@modules/admin/admin.routes', 'get', '/analytics/platform/export'],
    ['@modules/users/users.routes', 'get', '/'],
    ['@modules/users/users.routes', 'delete', '/:id'],
    ['@modules/tax/tax.routes', 'get', '/rules'],
    ['@modules/coupons/coupons.routes', 'patch', '/:id/status'],
    ['@modules/products/products.routes', 'post', '/:id/approve'],
    ['@modules/products/products.routes', 'post', '/:id/submit-on-behalf'],
    ['@modules/products/products.routes', 'post', '/on-behalf'],
    ['@modules/returns/returns.routes', 'get', '/admin'],
    ['@modules/bugReports/bugReports.routes', 'get', '/admin'],
  ];

  for (const [file, method, route] of adminOnly) {
    it(`${method.toUpperCase()} ${route} (${file.split('/')[1]}) is the Super Admin's alone`, async () => {
      assert.equal(await guard(file, method, route, ROLES.SUPER_ADMIN), undefined);
      for (const role of [ROLES.VENDOR_OWNER, ROLES.CUSTOMER]) {
        assert.ok(forbidden(await guard(file, method, route, role)), role);
      }
    });
  }

  const sharedWithVendor: Array<[string, string, string]> = [
    ['@modules/products/products.routes', 'delete', '/:id'],
    ['@modules/products/products.routes', 'delete', '/variants/:variantId'],
    ['@modules/payouts/payouts.routes', 'get', '/'],
    ['@modules/suborders/suborders.routes', 'get', '/'],
    ['@modules/vendors/vendors.routes', 'patch', '/me'],
    ['@modules/returns/returns.routes', 'post', '/:id/dispute'],
    ['@modules/returns/returns.routes', 'get', '/:id/debit-note'],
  ];

  for (const [file, method, route] of sharedWithVendor) {
    it(`${method.toUpperCase()} ${route} (${file.split('/')[1]}) is open to the vendor and the Super Admin, not to customers`, async () => {
      assert.equal(await guard(file, method, route, ROLES.VENDOR_OWNER), undefined);
      assert.equal(await guard(file, method, route, ROLES.SUPER_ADMIN), undefined);
      assert.ok(forbidden(await guard(file, method, route, ROLES.CUSTOMER)));
    });
  }
});

describe('removed features have no route', () => {
  const has = async (file: string, route: string) => layersOf(await router(file)).some((l) => l.route?.path === route);

  it('no vendor team routes and no way to change a role', async () => {
    assert.equal(await has('@modules/vendors/vendors.routes', '/me/staff'), false);
    assert.equal(await has('@modules/vendors/vendors.routes', '/me/staff/:userId'), false);
    assert.equal(await has('@modules/users/users.routes', '/:id/role'), false);
  });

  it('no role management mount', async () => {
    const { API_MOUNTS } = await import('@core/constants/apiPaths');
    assert.equal('roles' in API_MOUNTS, false);
    assert.equal(PERMISSIONS.USER_IMPERSONATE, 'user.impersonate');
  });
});
