import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { assertActorMayRunReport } from '@modules/reports/engine/reportEngine.helpers';
import { adminService, type DashboardMetrics, type PlatformAnalytics } from '../admin.service';
import { redactDashboardRevenue, redactPlatformRevenue } from '../adminRevenueRedaction';
import * as adminController from '../admin.controller';

const dashboard: DashboardMetrics = { totalOrders: 120, totalRevenue: 987654, totalVendors: 9, totalCustomers: 340, pendingApprovals: 4 };

const analytics: PlatformAnalytics = {
  gmv: 500000,
  paidGmv: 450000,
  aov: 1800,
  totalOrders: 120,
  totalCustomers: 340,
  totalVendors: 9,
  cancellationRate: 3.5,
  returnRate: 2.1,
  pendingProducts: 4,
  pendingVendors: 2,
  pendingReviews: 6,
  ordersGrowthPct: 8,
  revenueGrowthPct: 11.2,
  topVendors: [{ id: 'v1', businessName: 'Acme', revenue: 200000, sharePercent: 40 }],
  topCategories: [{ id: 'c1', name: 'Shirts', revenue: 90000, sharePercent: 18 }],
  orderVolume: [
    { date: '2026-11-24', count: 5, revenue: 9000 },
    { date: '2026-11-25', count: 7, revenue: 12500 },
  ],
  ordersByStatus: [{ status: 'DELIVERED', count: 80 }],
  paymentsByStatus: [{ status: 'PAID', count: 100 }],
  ratingDistribution: [{ rating: 5, count: 30 }],
};

describe('revenue redaction', () => {
  it('dashboard: only totalRevenue is removed', () => {
    assert.deepEqual(redactDashboardRevenue(dashboard), { ...dashboard, totalRevenue: null });
  });

  it('platform analytics: every revenue figure and revenue ranking is gone, every count stays', () => {
    const out = redactPlatformRevenue(analytics);
    assert.equal(out.gmv, null);
    assert.equal(out.paidGmv, null);
    assert.equal(out.aov, null);
    assert.equal(out.revenueGrowthPct, null);
    assert.deepEqual(out.topVendors, []);
    assert.deepEqual(out.topCategories, []);
    assert.deepEqual(out.orderVolume, [
      { date: '2026-11-24', count: 5, revenue: null },
      { date: '2026-11-25', count: 7, revenue: null },
    ]);
    for (const key of ['totalOrders', 'totalCustomers', 'totalVendors', 'cancellationRate', 'returnRate', 'pendingProducts', 'pendingVendors', 'pendingReviews', 'ordersGrowthPct', 'ordersByStatus', 'paymentsByStatus', 'ratingDistribution'] as const) {
      assert.deepEqual(out[key], analytics[key], key);
    }
  });

  it('leaks no revenue number anywhere in the serialised response', () => {
    const json = JSON.stringify(redactPlatformRevenue(analytics));
    for (const secret of ['500000', '450000', '1800', '11.2', '200000', '90000', '9000', '12500', 'Acme', 'Shirts']) {
      assert.ok(!json.includes(secret), `redacted analytics must not contain ${secret}`);
    }
    assert.ok(!JSON.stringify(redactDashboardRevenue(dashboard)).includes('987654'));
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(analytics);
    redactPlatformRevenue(analytics);
    assert.equal(JSON.stringify(analytics), before);
  });
});

describe('what each admin role actually receives from the analytics endpoints', () => {
  afterEach(() => {
    mock.restoreAll();
    clearPermissionCache();
  });

  async function call(
    handler: (req: Request, res: Response, next: (e?: unknown) => void) => unknown,
    role: string,
    permissions: string[] = [...(ROLE_PERMISSIONS[role] ?? [])],
  ) {
    setPermissionCache(`role-${role}`, permissions);
    const req = { user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId: null } } as unknown as Request;
    let body: { data?: Record<string, unknown> } = {};
    const res = {
      json: (b: typeof body) => {
        body = b;
        return res;
      },
    } as unknown as Response;
    await new Promise<void>((resolve, reject) => {
      void handler(req, res, (err) => (err ? reject(err) : resolve()));
      setTimeout(resolve, 50);
    });
    return body.data!;
  }

  const stub = () => {
    mock.method(adminService, 'getDashboardMetrics', async () => ({ ...dashboard }));
    mock.method(adminService, 'getPlatformAnalytics', async () => structuredClone(analytics));
  };

  it('Super Admin and the Finance Manager see revenue', async () => {
    stub();
    for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_FINANCE_MANAGER]) {
      const a = await call(adminController.getPlatformAnalytics, role);
      assert.equal(a.gmv, 500000, role);
      assert.equal((a.topVendors as unknown[]).length, 1, role);
      const d = await call(adminController.getDashboard, role);
      assert.equal(d.totalRevenue, 987654, role);
    }
  });

  it('the Order Manager and Catalog Manager get the counts but no revenue', async () => {
    stub();
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER]) {
      const a = await call(adminController.getPlatformAnalytics, role);
      assert.equal(a.gmv, null, role);
      assert.equal(a.paidGmv, null, role);
      assert.equal(a.aov, null, role);
      assert.deepEqual(a.topVendors, [], role);
      assert.equal(a.totalOrders, 120, role);
      assert.equal(a.pendingProducts, 4, role);
      const d = await call(adminController.getDashboard, role);
      assert.equal(d.totalRevenue, null, role);
      assert.equal(d.totalOrders, 120, role);
    }
  });

  it('a custom role granted only analytics.view gets no revenue; granting analytics.revenue unlocks it', async () => {
    stub();
    const viewOnly = await call(adminController.getPlatformAnalytics, 'ANALYST', ['analytics.view']);
    assert.equal(viewOnly.gmv, null);
    const withRevenue = await call(adminController.getPlatformAnalytics, 'ANALYST', ['analytics.view', 'analytics.revenue']);
    assert.equal(withRevenue.gmv, 500000);
  });
});

describe('reports that carry revenue now need analytics.revenue', () => {
  const actorFor = (role: string) => ({ roleName: role, vendorId: null, permissions: [...(ROLE_PERMISSIONS[role] ?? [])] as never });

  for (const type of ['platform-analytics', 'customer-analytics']) {
    it(`${type}: Super Admin and Finance Manager may run it; the operations managers may not`, () => {
      const def = getReportDefinition(type);
      assert.ok(def, `${type} must exist`);
      assert.deepEqual(def.permissions, ['analytics.revenue']);
      for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_FINANCE_MANAGER]) {
        assert.doesNotThrow(() => assertActorMayRunReport(actorFor(role), def), role);
      }
      for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER]) {
        assert.throws(() => assertActorMayRunReport(actorFor(role), def), (e: { statusCode?: number }) => e.statusCode === 403, role);
      }
    });
  }

  it('the non-revenue analytics report (newsletter subscribers) is still open to analytics.view', () => {
    const def = getReportDefinition('newsletter-subscribers');
    assert.ok(def);
    assert.doesNotThrow(() => assertActorMayRunReport(actorFor(ROLES.ADMIN_ORDER_MANAGER), def));
  });
});
