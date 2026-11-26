import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from '../permissionKeys';
import { ADMIN_ROLES, ROLES, ROLE_LABELS, ROLE_VALUES } from '@core/constants/statuses';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] };
};

const FINANCE = ROLES.ADMIN_FINANCE_MANAGER;
const permsOf = (role: string) => [...(ROLE_PERMISSIONS[role] ?? [])];
const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;

afterEach(() => clearPermissionCache());

async function guard(router: Router, method: string, path: string, role: string): Promise<unknown> {
  const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer?.route, `route ${method} ${path} not found`);
  setPermissionCache(`role-${role}`, permsOf(role));
  const req = { user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: null } } as unknown as Request;
  let outcome: unknown = 'not-called';
  await layer.route.stack[1]!.handle(req, {} as Response, ((err?: unknown) => {
    outcome = err;
  }) as NextFunction);
  return outcome;
}

const MONEY_ADMINS = [ROLES.SUPER_ADMIN, FINANCE];
const NOT_MONEY = [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER];

async function assertOnlyFor(router: Router, method: string, path: string, allowed: readonly string[], denied: readonly string[]) {
  for (const role of allowed) assert.equal(await guard(router, method, path, role), undefined, `${role} should pass ${method} ${path}`);
  for (const role of denied) assert.ok(forbidden(await guard(router, method, path, role)), `${role} should get 403 on ${method} ${path}`);
}

describe('the built-in Finance Manager role', () => {
  it('is registered as a role, a label and an admin role', () => {
    assert.equal(FINANCE, 'ADMIN_FINANCE_MANAGER');
    assert.ok(ROLE_VALUES.includes(FINANCE));
    assert.equal(ROLE_LABELS[FINANCE], 'Finance Manager');
    assert.ok((ADMIN_ROLES as readonly string[]).includes(FINANCE));
  });

  it('holds exactly the money permissions, nothing operational, catalog or system', () => {
    assert.deepEqual(
      permsOf(FINANCE).sort(),
      [
        PERMISSIONS.PAYOUT_MANAGE,
        PERMISSIONS.COMMISSION_VIEW,
        PERMISSIONS.ANALYTICS_VIEW,
        PERMISSIONS.ANALYTICS_REVENUE,
        PERMISSIONS.WALLET_ADJUST,
        PERMISSIONS.CASHBACK_MANAGE,
        PERMISSIONS.GIFT_CARD_MANAGE,
      ].sort(),
    );
    for (const forbiddenKey of [
      PERMISSIONS.ORDER_MANAGE,
      PERMISSIONS.ORDER_REFUND,
      PERMISSIONS.SHIPPING_MANAGE,
      PERMISSIONS.TICKET_MANAGE,
      PERMISSIONS.PRODUCT_MANAGE,
      PERMISSIONS.COUPON_MANAGE,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.ROLE_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.TAX_MANAGE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.VENDOR_MANAGE,
      PERMISSIONS.PAYOUT_VIEW, // a vendor-owner permission
    ]) {
      assert.ok(!permsOf(FINANCE).includes(forbiddenKey), `Finance Manager must not hold ${forbiddenKey}`);
    }
  });

  it('owns the money permissions together with Super Admin, and nobody else among built-ins', () => {
    for (const key of [PERMISSIONS.PAYOUT_MANAGE, PERMISSIONS.ANALYTICS_REVENUE, PERMISSIONS.WALLET_ADJUST, PERMISSIONS.CASHBACK_MANAGE, PERMISSIONS.GIFT_CARD_MANAGE]) {
      for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
        assert.equal(perms.includes(key), MONEY_ADMINS.includes(role as never), `${role} ${key}`);
      }
    }
  });

  it('the new permissions exist, and only Super Admin holds coupon.unlimited', () => {
    assert.ok(PERMISSION_KEYS.includes('analytics.revenue') && PERMISSION_KEYS.includes('coupon.unlimited'));
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      assert.equal(perms.includes(PERMISSIONS.COUPON_UNLIMITED), role === ROLES.SUPER_ADMIN, `${role} coupon.unlimited`);
    }
  });

  it('the Order Manager no longer holds gift_card.manage, and keeps its operations powers', () => {
    const order = permsOf(ROLES.ADMIN_ORDER_MANAGER);
    assert.ok(!order.includes(PERMISSIONS.GIFT_CARD_MANAGE));
    for (const key of [PERMISSIONS.ORDER_MANAGE, PERMISSIONS.ORDER_REFUND, PERMISSIONS.SHIPPING_MANAGE, PERMISSIONS.TICKET_MANAGE, PERMISSIONS.ANALYTICS_VIEW]) {
      assert.ok(order.includes(key), `Order Manager lost ${key}`);
    }
  });
});

describe('money endpoints: Finance Manager and Super Admin only', () => {
  it('gift cards: the admin list, liability and cancellation', async () => {
    const router = (await import('@modules/giftCards/giftCards.routes')).default;
    await assertOnlyFor(router, 'get', '/admin', MONEY_ADMINS, NOT_MONEY);
    await assertOnlyFor(router, 'get', '/admin/liability', MONEY_ADMINS, NOT_MONEY);
    await assertOnlyFor(router, 'post', '/admin/:id/cancel', MONEY_ADMINS, NOT_MONEY);
  });

  it('wallet adjustments and cashback offers', async () => {
    const wallet = (await import('@modules/wallet/wallet.admin.routes')).default;
    await assertOnlyFor(wallet, 'post', '/:userId/adjust', MONEY_ADMINS, NOT_MONEY);
    const cashback = (await import('@modules/cashbackOffers/cashbackOffers.routes')).default;
    await assertOnlyFor(cashback, 'get', '/', MONEY_ADMINS, NOT_MONEY);
    await assertOnlyFor(cashback, 'post', '/', MONEY_ADMINS, NOT_MONEY);
  });

  it('payouts: processing and marking paid are platform finance only', async () => {
    const router = (await import('@modules/payouts/payouts.routes')).default;
    await assertOnlyFor(router, 'post', '/process', MONEY_ADMINS, NOT_MONEY);
    await assertOnlyFor(router, 'patch', '/:id/mark-paid', MONEY_ADMINS, NOT_MONEY);
  });

  it('platform finance reports (commission.view)', async () => {
    const router = (await import('@modules/reports/reports.routes')).default;
    await assertOnlyFor(router, 'get', '/admin/summary', MONEY_ADMINS, [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.CUSTOMER]);
  });

  it('the revenue export needs analytics.revenue, not just analytics.view', async () => {
    const router = (await import('@modules/admin/admin.routes')).default;
    await assertOnlyFor(router, 'get', '/analytics/platform/export', MONEY_ADMINS, [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.VENDOR_OWNER]);
    // The operational analytics themselves stay open to the managers.
    await assertOnlyFor(router, 'get', '/analytics/platform', [ROLES.SUPER_ADMIN, FINANCE, ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER], [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER]);
  });
});

describe('the Finance Manager cannot reach operations, catalog or system endpoints', () => {
  it('orders, refunds, shipping, tickets, settings, users, tax and roles all refuse it', async () => {
    const checks: Array<[string, string, string]> = [
      ['@modules/orders/orders.routes', 'patch', '/:id/status'],
      ['@modules/returns/returns.routes', 'get', '/admin'],
      ['@modules/shipping/shipping.routes', 'get', '/zones'],
      ['@modules/supportTickets/supportTickets.routes', 'get', '/admin'],
      ['@modules/settings/settings.routes', 'put', '/'],
      ['@modules/users/users.routes', 'get', '/'],
      ['@modules/tax/tax.routes', 'get', '/rules'],
      ['@modules/bugReports/bugReports.routes', 'get', '/admin'],
      ['@modules/audit/audit.routes', 'get', '/'],
      ['@modules/webVitals/webVitals.routes', 'get', '/summary'],
    ];
    for (const [file, method, path] of checks) {
      const router = (await import(file)).default as Router;
      assert.ok(forbidden(await guard(router, method, path, FINANCE)), `Finance Manager should get 403 on ${method} ${path} (${file})`);
    }
  });

  it('and the other managers still cannot touch finance endpoints', async () => {
    const payouts = (await import('@modules/payouts/payouts.routes')).default;
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER]) {
      assert.ok(forbidden(await guard(payouts, 'post', '/process', role)), role);
    }
  });
});
