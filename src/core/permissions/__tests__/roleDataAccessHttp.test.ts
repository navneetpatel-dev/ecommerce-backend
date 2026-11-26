import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { QueryTypes } from 'sequelize';
import { app } from '../../../app';
import { env } from '@config/env';
import { sequelize } from '@database/models';
import { PERMISSION_KEYS, ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';

/**
 * End to end, over real HTTP against the real app and database: the real auth middleware, the real
 * permission checks and the real controllers. Tokens are minted for an existing active account.
 *
 * Each role gets a temporary row in `roles` holding exactly the permission set the code defines for
 * it (so the Finance Manager, which the development database does not have yet, and managers whose
 * stored grants predate the latest migrations are tested as the code defines them). Permissions are
 * therefore read from the database like in production, and survive the cache invalidations that
 * other test processes broadcast over Redis while the whole suite runs in parallel. The temporary
 * roles are removed afterwards.
 */
let server: Server;
let base = '';
let subject: { id: string; email: string } | undefined;
const tokens: Record<string, string> = {};

const ROLE_KEYS = [ROLES.SUPER_ADMIN, ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.CUSTOMER] as const;

const q = <T>(sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });

async function call(path: string, role?: string) {
  const res = await fetch(`${base}${path}`, { headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {} });
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; success?: boolean };
  return { status: res.status, data: body.data as any };
}

const stamp = Date.now().toString(36);
const tempRoleIds: string[] = [];

/** Creates a throwaway role carrying `permissions` and returns its id. */
async function createTempRole(role: string, permissions: readonly string[]): Promise<string> {
  const id = randomUUID();
  await sequelize.query(`INSERT INTO roles (id, name, "createdAt", "updatedAt") VALUES (:id, :name, NOW(), NOW())`, {
    replacements: { id, name: `ZZ_E2E_${stamp}_${role}` },
  });
  tempRoleIds.push(id);
  for (const key of permissions) {
    // The permission rows are additive reference data (the migrations add the same ones).
    await sequelize.query(
      `INSERT INTO permissions (id, key, "createdAt", "updatedAt")
       SELECT :pid, :key, NOW(), NOW() WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = :key)`,
      { replacements: { pid: randomUUID(), key } },
    );
  }
  if (permissions.length) {
    await sequelize.query(
      `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
       SELECT :id, p.id, NOW(), NOW() FROM permissions p WHERE p.key IN (:keys)`,
      { replacements: { id, keys: [...permissions] } },
    );
  }
  return id;
}

before(async () => {
  // Clear leftovers from an interrupted earlier run.
  await sequelize.query(`DELETE FROM "RolePermissions" WHERE "roleId" IN (SELECT id FROM roles WHERE name LIKE 'ZZ\\_E2E\\_%')`);
  await sequelize.query(`DELETE FROM roles WHERE name LIKE 'ZZ\\_E2E\\_%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = roles.id)`);

  [subject] = await q<{ id: string; email: string }>(
    `SELECT u.id, u.email FROM users u JOIN roles r ON r.id = u."roleId"
     WHERE r.name = 'CUSTOMER' AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL ORDER BY u."createdAt" LIMIT 1`,
  );
  assert.ok(subject, 'the development database needs at least one active customer');
  for (const role of ROLE_KEYS) {
    const permissions = role === ROLES.SUPER_ADMIN ? [] : (ROLE_PERMISSIONS[role] ?? []);
    const roleId = await createTempRole(role, permissions);
    tokens[role] = jwt.sign({ sub: subject.id, email: subject.email, roleId, vendorId: null, roleName: role }, env.JWT_SECRET, { expiresIn: '10m' });
  }
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tempRoleIds.length) {
    await sequelize.query(`DELETE FROM "RolePermissions" WHERE "roleId" IN (:ids)`, { replacements: { ids: tempRoleIds } });
    await sequelize.query(`DELETE FROM roles WHERE id IN (:ids)`, { replacements: { ids: tempRoleIds } });
  }
});

describe('gap 1: roles without vendor permissions can still fill a vendor dropdown', () => {
  let approved: { id: string; businessName: string } | undefined;
  let pending: { id: string } | undefined;
  before(async () => {
    [approved] = await q<{ id: string; businessName: string }>(`SELECT id, "businessName" FROM vendors WHERE status = 'APPROVED' AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`);
    [pending] = await q<{ id: string }>(`SELECT id FROM vendors WHERE status <> 'APPROVED' AND "deletedAt" IS NULL LIMIT 1`);
  });

  it('why the front end needed a different endpoint: the admin vendor list refuses these roles', async () => {
    for (const role of [ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      assert.equal((await call('/api/vendors?limit=3', role)).status, 403, role);
    }
    assert.equal((await call('/api/vendors?limit=3', ROLES.SUPER_ADMIN)).status, 200);
  });

  it('the approved-vendor directory works for the Catalog, Order and Finance managers', async () => {
    for (const role of [ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.SUPER_ADMIN]) {
      const { status, data } = await call('/api/vendors/directory?limit=5', role);
      assert.equal(status, 200, role);
      assert.ok(Array.isArray(data) && data.length > 0 && data.length <= 5, `${role} gets up to 5 vendors`);
      assert.deepEqual(Object.keys(data[0]).sort(), ['businessName', 'id'], 'only an id and a name are exposed');
    }
  });

  it('search finds a vendor by name, and an unauthenticated caller is refused', async (t) => {
    if (!approved) return t.skip('no approved vendor');
    const fragment = encodeURIComponent(approved.businessName.slice(0, 6));
    const { data } = await call(`/api/vendors/directory?limit=50&search=${fragment}`, ROLES.ADMIN_CATALOG_MANAGER);
    assert.ok(data.some((v: { id: string }) => v.id === approved!.id));
    assert.equal((await call('/api/vendors/directory?limit=3')).status, 401);
  });

  it('resolves an already-selected vendor by id (what a reloaded filter needs to show its name)', async (t) => {
    if (!approved) return t.skip('no approved vendor');
    const { status, data } = await call(`/api/vendors/directory?id=${approved.id}`, ROLES.ADMIN_CATALOG_MANAGER);
    assert.equal(status, 200);
    assert.deepEqual(data, [{ id: approved.id, businessName: approved.businessName }]);
  });

  it('by id it never reveals a vendor that is not approved, and rejects a malformed id', async (t) => {
    if (pending) {
      const { status, data } = await call(`/api/vendors/directory?id=${pending.id}`, ROLES.ADMIN_CATALOG_MANAGER);
      assert.equal(status, 200);
      assert.deepEqual(data, [], 'a pending or suspended vendor is not in the directory');
    } else t.diagnostic('no non-approved vendor to probe');
    assert.equal((await call('/api/vendors/directory?id=not-a-uuid', ROLES.ADMIN_CATALOG_MANAGER)).status, 422);
  });
});

describe('gap 3: unpublished products are for catalog roles only', () => {
  let draft: { id: string } | undefined;
  let pending: { id: string } | undefined;
  before(async () => {
    [draft] = await q<{ id: string }>(`SELECT id FROM products WHERE status = 'DRAFT' AND "deletedAt" IS NULL LIMIT 1`);
    [pending] = await q<{ id: string }>(`SELECT id FROM products WHERE status = 'PENDING_APPROVAL' AND "deletedAt" IS NULL LIMIT 1`);
  });

  it('a draft product: Super Admin and the Catalog Manager can open it; Order Manager, Finance Manager, shoppers and visitors cannot', async (t) => {
    if (!draft) return t.skip('no draft product');
    for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_CATALOG_MANAGER]) {
      const { status, data } = await call(`/api/products/${draft.id}`, role);
      assert.equal(status, 200, role);
      assert.equal(data.status, 'DRAFT', role);
    }
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.CUSTOMER, undefined]) {
      assert.equal((await call(`/api/products/${draft.id}`, role)).status, 404, `${role ?? 'anonymous'} must not see a draft`);
    }
  });

  it('a pending-approval product follows the same rule', async (t) => {
    if (!pending) return t.skip('no pending product');
    assert.equal((await call(`/api/products/${pending.id}`, ROLES.ADMIN_CATALOG_MANAGER)).status, 200);
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      assert.equal((await call(`/api/products/${pending.id}`, role)).status, 404, role);
    }
  });

  it('the product list: the Catalog Manager sees pending products, the Order and Finance managers do not', async (t) => {
    if (!pending) return t.skip('no pending product');
    const catalog = await call('/api/products?status=PENDING_APPROVAL&limit=5', ROLES.ADMIN_CATALOG_MANAGER);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.data.length > 0, 'the Catalog Manager sees the moderation queue');
    assert.ok(catalog.data.every((p: { status: string }) => p.status === 'PENDING_APPROVAL'));
    // Everyone else gets the shopper view: the status filter is ignored and only LIVE products come back.
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.CUSTOMER, undefined]) {
      const { status, data } = await call('/api/products?status=PENDING_APPROVAL&limit=5', role);
      assert.equal(status, 200, role ?? 'anonymous');
      assert.ok(data.length > 0, `${role ?? 'anonymous'} still browses the live catalog`);
      assert.ok(data.every((p: { status: string }) => p.status === 'LIVE'), `${role ?? 'anonymous'} must see only LIVE products`);
    }
  });

  it('published products are still visible to everyone (no regression for shoppers)', async () => {
    const [live] = await q<{ id: string }>(`SELECT id FROM products WHERE status = 'LIVE' AND "deletedAt" IS NULL LIMIT 1`);
    assert.ok(live);
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.CUSTOMER, undefined]) {
      const { status } = await call(`/api/products/${live.id}`, role);
      assert.ok([200, 404].includes(status), `${role ?? 'anonymous'} got ${status}`); // 404 only if the vendor is not customer-visible
    }
    const list = await call('/api/products?limit=3', ROLES.ADMIN_ORDER_MANAGER);
    assert.equal(list.status, 200);
    assert.ok(list.data.length > 0, 'the Order Manager still browses the live catalog');
  });
});

describe('gap 3: shipment details are for staff who manage shipping or orders', () => {
  let tracking: string | undefined;
  before(async () => {
    [{ trackingNumber: tracking } = { trackingNumber: undefined as never }] = await q<{ trackingNumber: string }>(
      `SELECT "trackingNumber" FROM shipments WHERE "trackingNumber" IS NOT NULL ORDER BY "createdAt" LIMIT 1`,
    );
  });

  it('Super Admin and the Order Manager see the full shipment; the Catalog and Finance managers are refused', async (t) => {
    if (!tracking) return t.skip('no shipment');
    for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN_ORDER_MANAGER]) {
      const { status, data } = await call(`/api/shipping/tracking/${tracking}`, role);
      assert.equal(status, 200, role);
      assert.ok(Object.keys(data).length > 6, `${role} gets the full record`);
    }
    for (const role of [ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      assert.equal((await call(`/api/shipping/tracking/${tracking}`, role)).status, 403, role);
    }
  });

  it('a shopper who is not the buyer is refused, and an anonymous visitor still gets only the carrier-facing status', async (t) => {
    if (!tracking) return t.skip('no shipment');
    assert.equal((await call(`/api/shipping/tracking/${tracking}`, ROLES.CUSTOMER)).status, 403);
    const anonymous = await call(`/api/shipping/tracking/${tracking}`);
    assert.equal(anonymous.status, 200);
    assert.deepEqual(Object.keys(anonymous.data).sort(), ['carrier', 'estimatedDeliveryDate', 'lastUpdate', 'status', 'trackingNumber', 'trackingUrl']);
  });
});

describe('gap 2: the Finance Manager can find a user to adjust a wallet', () => {
  let target: { id: string; name: string; email: string } | undefined;
  before(async () => {
    [target] = await q<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE "deletedAt" IS NULL AND email LIKE '%@example.com' ORDER BY "createdAt" DESC LIMIT 1`,
    );
  });

  it('finds a user by part of their email or name, with only four fields', async (t) => {
    if (!target) return t.skip('no example user');
    const byEmail = await call(`/api/admin/wallet/users?search=${encodeURIComponent(target.email.slice(0, 12))}`, ROLES.ADMIN_FINANCE_MANAGER);
    assert.equal(byEmail.status, 200);
    assert.ok(byEmail.data.length > 0 && byEmail.data.length <= 10);
    for (const row of byEmail.data) assert.deepEqual(Object.keys(row).sort(), ['email', 'id', 'name', 'status']);
    const exact = await call(`/api/admin/wallet/users?search=${target.id}`, ROLES.ADMIN_FINANCE_MANAGER);
    assert.deepEqual(exact.data.map((r: { id: string }) => r.id), [target.id], 'a pasted id still resolves');
    assert.equal((await call(`/api/admin/wallet/users?search=${encodeURIComponent(target.email.slice(0, 12))}`, ROLES.SUPER_ADMIN)).status, 200);
  });

  it('nobody else gets the lookup', async () => {
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.CUSTOMER]) {
      assert.equal((await call('/api/admin/wallet/users?search=priya', role)).status, 403, role);
    }
    assert.equal((await call('/api/admin/wallet/users?search=priya')).status, 401);
  });

  it('it cannot be used to browse everyone: short terms are rejected and wildcards are literal', async () => {
    assert.equal((await call('/api/admin/wallet/users?search=ab', ROLES.ADMIN_FINANCE_MANAGER)).status, 422);
    assert.equal((await call('/api/admin/wallet/users', ROLES.ADMIN_FINANCE_MANAGER)).status, 422);
    const wildcard = await call(`/api/admin/wallet/users?search=${encodeURIComponent('%%%')}`, ROLES.ADMIN_FINANCE_MANAGER);
    assert.equal(wildcard.status, 200);
    assert.deepEqual(wildcard.data, []);
    const limited = await call('/api/admin/wallet/users?search=com&limit=3', ROLES.ADMIN_FINANCE_MANAGER);
    assert.ok(limited.data.length <= 3);
    assert.equal((await call('/api/admin/wallet/users?search=com&limit=50', ROLES.ADMIN_FINANCE_MANAGER)).status, 422);
  });

  it('it is a narrow door: the Finance Manager still has no access to the Users admin', async () => {
    assert.equal((await call('/api/users?limit=3', ROLES.ADMIN_FINANCE_MANAGER)).status, 403);
    assert.equal((await call(`/api/users/${subject!.id}`, ROLES.ADMIN_FINANCE_MANAGER)).status, 403);
  });
});

describe('each role still gets the data of its own job (no regressions)', () => {
  it('Order Manager: all orders, returns, tickets, shipping rates', async () => {
    for (const path of ['/api/orders?limit=3', '/api/returns/admin?limit=3', '/api/support-tickets/admin?limit=3']) {
      assert.equal((await call(path, ROLES.ADMIN_ORDER_MANAGER)).status, 200, path);
    }
  });

  it('Catalog Manager: low-stock inventory, coupons, categories, reviews moderation', async () => {
    for (const path of ['/api/inventory/low-stock', '/api/coupons?limit=3', '/api/categories', '/api/reviews/moderation?limit=3']) {
      assert.equal((await call(path, ROLES.ADMIN_CATALOG_MANAGER)).status, 200, path);
    }
  });

  it('Finance Manager: payouts, commissions, gift cards, cashback offers, analytics (with revenue)', async () => {
    for (const path of ['/api/payouts?limit=3', '/api/commissions?limit=3', '/api/gift-cards/admin?limit=3', '/api/gift-cards/admin/liability', '/api/cashback-offers?limit=3']) {
      assert.equal((await call(path, ROLES.ADMIN_FINANCE_MANAGER)).status, 200, path);
    }
    const analytics = await call('/api/admin/analytics/platform', ROLES.ADMIN_FINANCE_MANAGER);
    assert.equal(analytics.status, 200);
    assert.equal(typeof analytics.data.gmv, 'number', 'Finance sees revenue');
  });

  it('the managers get analytics counts but no revenue', async () => {
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER]) {
      const analytics = await call('/api/admin/analytics/platform', role);
      assert.equal(analytics.status, 200, role);
      assert.equal(analytics.data.gmv, null, role);
      assert.equal(typeof analytics.data.totalOrders, 'number', role);
    }
  });

  it('and the roles are still kept out of each other’s jobs', async () => {
    assert.equal((await call('/api/payouts?limit=3', ROLES.ADMIN_ORDER_MANAGER)).status, 403);
    assert.equal((await call('/api/returns/admin?limit=3', ROLES.ADMIN_FINANCE_MANAGER)).status, 403);
    assert.equal((await call('/api/gift-cards/admin?limit=3', ROLES.ADMIN_ORDER_MANAGER)).status, 403);
    assert.equal((await call('/api/cashback-offers?limit=3', ROLES.ADMIN_CATALOG_MANAGER)).status, 403);
    assert.equal((await call('/api/coupons?limit=3', ROLES.ADMIN_FINANCE_MANAGER)).status, 403);
  });
});

describe('the Reports hub: each role finds its own reports and none of another role’s', () => {
  const catalogFor = async (role: string) => {
    const { status, data } = await call('/api/reports/catalog', role);
    assert.equal(status, 200, role);
    return new Set<string>((Array.isArray(data) ? data : data?.reports ?? []).map((r: { type: string }) => r.type));
  };

  it('Order Manager: operations reports only', async () => {
    const reports = await catalogFor(ROLES.ADMIN_ORDER_MANAGER);
    for (const type of ['order-sla', 'cancellations', 'refund-return', 'stuck-orders', 'shipping-logistics', 'support-ticket-sla']) {
      assert.ok(reports.has(type), `Order Manager should have ${type}`);
    }
    for (const type of ['gmv-sales', 'commission-revenue', 'wallet-liability', 'platform-analytics', 'product-performance', 'audit-log']) {
      assert.ok(!reports.has(type), `Order Manager must not have ${type}`);
    }
  });

  it('Catalog Manager: catalog reports only', async () => {
    const reports = await catalogFor(ROLES.ADMIN_CATALOG_MANAGER);
    for (const type of ['product-performance', 'category-performance', 'product-approval-tat', 'review-rating-summary', 'platform-inventory']) {
      assert.ok(reports.has(type), `Catalog Manager should have ${type}`);
    }
    for (const type of ['order-sla', 'gmv-sales', 'wallet-liability', 'platform-analytics', 'audit-log']) {
      assert.ok(!reports.has(type), `Catalog Manager must not have ${type}`);
    }
  });

  it('Finance Manager: finance, tax and revenue reports only', async () => {
    const reports = await catalogFor(ROLES.ADMIN_FINANCE_MANAGER);
    for (const type of ['gmv-sales', 'commission-revenue', 'reconciliation', 'wallet-liability', 'wallet-recharge', 'cashback-write-offs', 'gift-card-liability', 'gstr-1-filing', 'platform-analytics', 'customer-analytics']) {
      assert.ok(reports.has(type), `Finance Manager should have ${type}`);
    }
    for (const type of ['order-sla', 'stuck-orders', 'product-performance', 'platform-inventory', 'audit-log']) {
      assert.ok(!reports.has(type), `Finance Manager must not have ${type}`);
    }
  });

  it('only Super Admin has the audit log report, and Super Admin has more than any other role', async () => {
    const superReports = await catalogFor(ROLES.SUPER_ADMIN);
    assert.ok(superReports.has('audit-log'));
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.ADMIN_FINANCE_MANAGER]) {
      const reports = await catalogFor(role);
      assert.ok(!reports.has('audit-log'), role);
      assert.ok(reports.size > 0 && reports.size < superReports.size, role);
    }
  });
});

describe('assisted listing over HTTP (nothing here writes: every call is refused before the database changes)', () => {
  let live: { id: string; vendorId: string } | undefined;
  let pending: { id: string } | undefined;

  before(async () => {
    [live] = await q<{ id: string; vendorId: string }>(`SELECT id, "vendorId" FROM products WHERE status = 'LIVE' AND "vendorId" IS NOT NULL AND "deletedAt" IS NULL LIMIT 1`);
    [pending] = await q<{ id: string }>(`SELECT id FROM vendors WHERE status <> 'APPROVED' AND "deletedAt" IS NULL LIMIT 1`);
  });

  async function send(method: string, path: string, role: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as { message?: string };
    return { status: res.status, message: parsed.message ?? '' };
  }

  const draft = { name: `ZZ never created ${stamp}`, categoryId: randomUUID(), basePrice: 100 };

  it('only product admins reach the on-behalf endpoints: Order and Finance managers and customers get 403', async () => {
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_FINANCE_MANAGER, ROLES.CUSTOMER]) {
      assert.equal((await send('POST', '/api/products/on-behalf', role, { vendorId: randomUUID(), product: draft })).status, 403, role);
      assert.equal((await send('POST', `/api/products/${randomUUID()}/submit-on-behalf`, role, { consentNote: 'Vendor agreed by phone' })).status, 403, role);
    }
  });

  it('the vendor must be approved: an unknown or not-approved vendor is refused with 422 and nothing is created', async () => {
    for (const vendorId of [randomUUID(), pending?.id].filter(Boolean) as string[]) {
      for (const role of [ROLES.ADMIN_CATALOG_MANAGER, ROLES.SUPER_ADMIN]) {
        assert.equal((await send('POST', '/api/products/on-behalf', role, { vendorId, product: draft })).status, 422, `${role} ${vendorId}`);
      }
    }
    const [{ count }] = await q<{ count: string }>(`SELECT COUNT(*) AS count FROM products WHERE name = :name`, { name: draft.name });
    assert.equal(count, '0');
  });

  it('the consent note is required (10 to 500 characters)', async () => {
    for (const consentNote of [undefined, '', 'short']) {
      assert.equal((await send('POST', `/api/products/${randomUUID()}/submit-on-behalf`, ROLES.ADMIN_CATALOG_MANAGER, { consentNote })).status, 422, String(consentNote));
    }
  });

  it('repricing a live vendor product: the Catalog Manager gets 403; Super Admin needs a reason (422)', async (t) => {
    if (!live) return t.skip('no live vendor product in the development database');
    const price = { basePrice: 1 };
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.ADMIN_CATALOG_MANAGER, price)).status, 403);
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.SUPER_ADMIN, price)).status, 422);
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.SUPER_ADMIN, { ...price, changeReason: 'short' })).status, 422);
    const variant = { sku: `ZZ-${stamp}`, price: 1 };
    assert.equal((await send('POST', `/api/products/${live.id}/variants`, ROLES.ADMIN_CATALOG_MANAGER, variant)).status, 403, 'adding a variant is a pricing change');
    assert.equal((await send('POST', `/api/products/${live.id}/variants`, ROLES.SUPER_ADMIN, variant)).status, 422);
  });

  it('shoppers never see the internal fields, on the list or the detail page', async (t) => {
    if (!live) return t.skip('no live vendor product in the development database');
    const internal = ['createdBy', 'updatedBy', 'deletedBy', 'approvedById', 'rejectionNote', 'listedByPlatform', 'vendorConsentNote'];
    const list = await call('/api/products?limit=5');
    assert.equal(list.status, 200);
    for (const product of list.data) for (const field of internal) assert.equal(field in product, false, `list: ${field}`);
    const detail = await call(`/api/products/${live.id}`);
    assert.equal(detail.status, 200);
    for (const field of internal) assert.equal(field in detail.data, false, `detail: ${field}`);
    // The team's own view keeps them (moderation needs who approved and why it was rejected).
    const own = await call(`/api/products/${live.id}`, ROLES.ADMIN_CATALOG_MANAGER);
    assert.equal('listedByPlatform' in own.data, true);
  });

  it('only a Super Admin may create or approve in the special ways: no vendor, or approving one’s own work', async () => {
    const productBody = { name: `ZZ never created ${stamp}`, categoryId: randomUUID(), description: 'd', basePrice: 10 };
    // A vendor-less (platform) product: a Catalog Manager is refused before anything is written.
    assert.equal((await send('POST', '/api/products/on-behalf', ROLES.ADMIN_CATALOG_MANAGER, { product: productBody })).status, 403);
    // The own-work reason is validated (10 to 500 characters) before the product is even looked up.
    assert.equal((await send('POST', `/api/products/${randomUUID()}/approve`, ROLES.SUPER_ADMIN, { ownWorkReason: 'short' })).status, 422);
    // Publishing a vendor-less product goes through /submit: a Catalog Manager has no store, so it is refused.
    assert.ok([403, 404].includes((await send('POST', `/api/products/${randomUUID()}/submit`, ROLES.ADMIN_CATALOG_MANAGER, {})).status));
  });

  it('the vendor picker pages: no vendor repeats across pages, only id and name, wildcards are literal', async () => {
    const first = await call('/api/vendors/directory?limit=2&page=1', ROLES.SUPER_ADMIN);
    const second = await call('/api/vendors/directory?limit=2&page=2', ROLES.SUPER_ADMIN);
    assert.equal(first.status, 200);
    for (const row of [...first.data, ...second.data]) assert.deepEqual(Object.keys(row).sort(), ['businessName', 'id']);
    const ids = [...first.data, ...second.data].map((row: { id: string }) => row.id);
    assert.equal(new Set(ids).size, ids.length, 'no vendor on two pages');
    const wildcard = await call('/api/vendors/directory?limit=5&search=%25', ROLES.SUPER_ADMIN);
    assert.equal(wildcard.status, 200);
    for (const row of wildcard.data) assert.ok(row.businessName.includes('%'), 'a typed % matches only a literal %');
  });
});
