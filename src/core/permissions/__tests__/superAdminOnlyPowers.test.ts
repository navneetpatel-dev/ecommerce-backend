import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from '../permissionKeys';
import { ROLES } from '@core/constants/statuses';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

const permsOf = (role: string) => [...(ROLE_PERMISSIONS[role] ?? [])];
const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;

/** Held by nobody but the Super Admin among the built-in roles. */
const SUPER_ADMIN_ONLY = [
  PERMISSIONS.WEBVITALS_VIEW,
  PERMISSIONS.COUPON_UNLIMITED,
  PERMISSIONS.BUG_REPORT_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.USER_IMPERSONATE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.PRODUCT_PRICING,
] as const;

/** Money powers: the Super Admin and the Finance Manager, and no operations manager. */
const SUPER_ADMIN_AND_FINANCE = [
  PERMISSIONS.WALLET_ADJUST,
  PERMISSIONS.CASHBACK_MANAGE,
  PERMISSIONS.GIFT_CARD_MANAGE,
  PERMISSIONS.ANALYTICS_REVENUE,
] as const;

describe('powers that belong to the Super Admin alone', () => {
  it('only SUPER_ADMIN holds each of them among the built-in roles', () => {
    for (const key of SUPER_ADMIN_ONLY) {
      assert.ok(PERMISSION_KEYS.includes(key), `${key} must be a registered permission`);
      for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
        assert.equal(perms.includes(key), role === ROLES.SUPER_ADMIN, `${role} ${key} should be ${role === ROLES.SUPER_ADMIN}`);
      }
    }
  });

  it('the money powers belong to Super Admin and the Finance Manager only', () => {
    for (const key of SUPER_ADMIN_AND_FINANCE) {
      assert.ok(PERMISSION_KEYS.includes(key), `${key} must be a registered permission`);
      for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
        const expected = role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN_FINANCE_MANAGER;
        assert.equal(perms.includes(key), expected, `${role} ${key} should be ${expected}`);
      }
    }
  });

  it('the new permissions have the expected keys', () => {
    assert.equal(PERMISSIONS.CASHBACK_MANAGE, 'cashback.manage');
    assert.equal(PERMISSIONS.WEBVITALS_VIEW, 'webvitals.view');
  });

  it('the managers keep everything else they need for their jobs', () => {
    const order = ROLE_PERMISSIONS[ROLES.ADMIN_ORDER_MANAGER]!;
    for (const key of [PERMISSIONS.ORDER_MANAGE, PERMISSIONS.ORDER_REFUND, PERMISSIONS.SHIPPING_MANAGE, PERMISSIONS.TICKET_MANAGE, PERMISSIONS.ANALYTICS_VIEW]) {
      assert.ok(order.includes(key), `Order Manager lost ${key}`);
    }
    const catalog = ROLE_PERMISSIONS[ROLES.ADMIN_CATALOG_MANAGER]!;
    for (const key of [PERMISSIONS.PRODUCT_MANAGE, PERMISSIONS.PRODUCT_CREATE, PERMISSIONS.PRODUCT_APPROVE, PERMISSIONS.CATEGORY_MANAGE, PERMISSIONS.COUPON_MANAGE, PERMISSIONS.BANNER_MANAGE, PERMISSIONS.REVIEW_MODERATE, PERMISSIONS.ANALYTICS_VIEW]) {
      assert.ok(catalog.includes(key), `Catalog Manager lost ${key}`);
    }
  });

  it('only vendor owners (and Super Admin) can delete products; the Catalog Manager cannot', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const can = perms.includes(PERMISSIONS.PRODUCT_DELETE);
      assert.equal(can, role === ROLES.VENDOR_OWNER || role === ROLES.SUPER_ADMIN, `${role} product.delete`);
    }
  });
});

afterEach(() => clearPermissionCache());

/** Runs the permission guard (2nd handler, right after `authenticate`) for a user holding `permissions`. */
async function guardOf(router: Router, method: string, path: string, role: string, permissions: string[]): Promise<unknown> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  const roleId = `role-${role}`;
  setPermissionCache(roleId, permissions);
  const req = { user: { id: 'u1', roleId, role: { name: role }, vendorId: role.startsWith('VENDOR') ? 'v1' : null } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layer.route.stack[1]!.handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const EVERYONE_ELSE = [
  ROLES.ADMIN_ORDER_MANAGER,
  ROLES.ADMIN_CATALOG_MANAGER,
  ROLES.VENDOR_OWNER,
  ROLES.VENDOR_STAFF,
  ROLES.CUSTOMER,
];

async function assertSuperAdminOnly(router: Router, method: string, path: string, who = EVERYONE_ELSE as readonly string[]) {
  assert.equal(await guardOf(router, method, path, ROLES.SUPER_ADMIN, permsOf(ROLES.SUPER_ADMIN)), undefined, `Super Admin on ${method} ${path}`);
  for (const role of who) {
    assert.ok(forbidden(await guardOf(router, method, path, role, permsOf(role))), `${role} should get 403 on ${method} ${path}`);
  }
}

describe('wallet adjustments (POST /admin/wallet/:userId/adjust)', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/wallet/wallet.admin.routes')).default;
  });

  it('are refused to the operations managers, vendors and customers; a custom role explicitly granted wallet.adjust still passes', async () => {
    await assertSuperAdminOnly(router, 'post', '/:userId/adjust');
    assert.equal(await guardOf(router, 'post', '/:userId/adjust', 'GIFT_CARD_DESK', ['wallet.adjust']), undefined);
  });
});

describe('cashback offers admin API', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/cashbackOffers/cashbackOffers.routes')).default;
  });

  for (const [method, path] of [['get', '/'], ['post', '/'], ['patch', '/:id'], ['delete', '/:id']] as const) {
    it(`${method.toUpperCase()} /cashback-offers${path} is refused to the operations managers, vendors and customers; coupon.manage no longer opens it`, async () => {
      await assertSuperAdminOnly(router, method, path);
      assert.ok(forbidden(await guardOf(router, method, path, 'COUPON_DESK', ['coupon.manage'])), 'coupon.manage must not grant cashback access');
      assert.equal(await guardOf(router, method, path, 'CASHBACK_DESK', ['cashback.manage']), undefined);
    });
  }

  it('the shopper-facing live offers list stays public', () => {
    const live = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/live');
    assert.ok(live?.route);
    assert.equal(live.route.stack.length, 1, 'no auth or permission guard on /live');
  });
});

describe('web vitals', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/webVitals/webVitals.routes')).default;
  });

  it('GET /summary is Super Admin only; analytics.view no longer opens it', async () => {
    await assertSuperAdminOnly(router, 'get', '/summary');
    assert.ok(forbidden(await guardOf(router, 'get', '/summary', 'ANALYST', ['analytics.view'])));
    assert.equal(await guardOf(router, 'get', '/summary', 'SRE', ['webvitals.view']), undefined);
  });

  it('the browser beacon (POST /) stays open to everyone', () => {
    const post = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/' && l.route.methods.post);
    assert.ok(post?.route);
    // optionalAuthenticate + validate + controller: no permission guard.
    assert.equal(post.route.stack.length, 3);
  });
});

describe('deleting products and variants', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/products/products.routes')).default;
  });

  for (const path of ['/:id', '/variants/:variantId']) {
    it(`DELETE /products${path}: vendor owner and Super Admin pass; Catalog Manager, Order Manager, staff and customers get 403`, async () => {
      assert.equal(await guardOf(router, 'delete', path, ROLES.VENDOR_OWNER, permsOf(ROLES.VENDOR_OWNER)), undefined);
      await assertSuperAdminOnly(router, 'delete', path, [ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_ORDER_MANAGER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER]);
    });

    it(`DELETE /products${path}: product.manage alone is no longer enough`, async () => {
      assert.ok(forbidden(await guardOf(router, 'delete', path, 'CATALOG_LEAD', ['product.manage'])));
    });
  }

  it('the Catalog Manager keeps editing, archiving and approving', async () => {
    const catalog = permsOf(ROLES.ADMIN_CATALOG_MANAGER);
    for (const [method, path] of [['patch', '/:id'], ['post', '/:id/archive'], ['post', '/:id/unarchive'], ['post', '/:id/approve'], ['post', '/:id/reject']] as const) {
      assert.equal(await guardOf(router, method, path, ROLES.ADMIN_CATALOG_MANAGER, catalog), undefined, `${method} ${path}`);
    }
  });
});

describe('assisted listing (admin lists and edits products for a vendor)', () => {
  let router: Router;
  before(async () => {
    router = (await import('@modules/products/products.routes')).default;
  });

  it('product.pricing is Super Admin only; the Catalog Manager can create, edit, submit and approve but not reprice live products', () => {
    assert.equal(PERMISSIONS.PRODUCT_PRICING, 'product.pricing');
    assert.ok(!permsOf(ROLES.ADMIN_CATALOG_MANAGER).includes(PERMISSIONS.PRODUCT_PRICING));
  });

  /** The route stacks two `authorize` guards (after `authenticate`); both must pass. */
  async function bothGuards(role: string, permissions: string[]): Promise<unknown> {
    const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/on-behalf' && l.route.methods.post)!;
    setPermissionCache(`role-${role}`, permissions);
    const req = { user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: null } } as unknown as Request;
    for (const index of [1, 2]) {
      let outcome: unknown;
      await layer.route!.stack[index]!.handle(req, {} as Response, ((err?: unknown) => {
        outcome = err;
      }) as NextFunction);
      if (outcome) return outcome;
    }
    return undefined;
  }

  it('POST /products/on-behalf needs product.manage AND product.create', async () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_CATALOG_MANAGER]) {
      assert.equal(await bothGuards(role, permsOf(role)), undefined, role);
    }
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER]) {
      assert.ok(forbidden(await bothGuards(role, permsOf(role))), role);
    }
    assert.ok(forbidden(await bothGuards('ONLY_MANAGE', ['product.manage'])), 'manage alone');
    assert.ok(forbidden(await bothGuards('ONLY_CREATE', ['product.create'])), 'create alone');
  });

  it('POST /products/:id/submit-on-behalf is for product.manage only (a vendor owner submits their own product instead)', async () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_CATALOG_MANAGER]) {
      assert.equal(await guardOf(router, 'post', '/:id/submit-on-behalf', role, permsOf(role)), undefined, role);
    }
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER]) {
      assert.ok(forbidden(await guardOf(router, 'post', '/:id/submit-on-behalf', role, permsOf(role))), role);
    }
  });
});

describe('admin coupons stay with the Catalog Manager', () => {
  it('coupon.manage still opens the platform coupon admin API', async () => {
    const router = (await import('@modules/coupons/coupons.routes')).default;
    assert.equal(await guardOf(router, 'get', '/', ROLES.ADMIN_CATALOG_MANAGER, permsOf(ROLES.ADMIN_CATALOG_MANAGER)), undefined);
    assert.ok(forbidden(await guardOf(router, 'get', '/', ROLES.ADMIN_ORDER_MANAGER, permsOf(ROLES.ADMIN_ORDER_MANAGER))));
  });
});
