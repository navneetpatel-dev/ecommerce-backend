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
 * it, whatever grants the database under test happens to store. Permissions are
 * therefore read from the database like in production, and survive the cache invalidations that
 * other test processes broadcast over Redis while the whole suite runs in parallel. The temporary
 * roles are removed afterwards.
 */
let server: Server;
let base = '';
let subject: { id: string; email: string } | undefined;
const tokens: Record<string, string> = {};

const ROLE_KEYS = [ROLES.SUPER_ADMIN, ROLES.VENDOR_OWNER, ROLES.CUSTOMER] as const;
let seller: { id: string; email: string; vendorId: string } | undefined;

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
  [seller] = await q<{ id: string; email: string; vendorId: string }>(
    `SELECT u.id, u.email, u."vendorId" FROM users u JOIN roles r ON r.id = u."roleId"
     JOIN vendors v ON v.id = u."vendorId" AND v.status = 'APPROVED' AND v."deletedAt" IS NULL
     WHERE r.name = 'VENDOR_OWNER' AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL ORDER BY u."createdAt" LIMIT 1`,
  );
  assert.ok(seller, 'the database needs at least one active vendor');
  for (const role of ROLE_KEYS) {
    const permissions = role === ROLES.SUPER_ADMIN ? [] : (ROLE_PERMISSIONS[role] ?? []);
    const roleId = await createTempRole(role, permissions);
    const who = role === ROLES.VENDOR_OWNER ? seller : { ...subject, vendorId: null };
    tokens[role] = jwt.sign({ sub: who.id, email: who.email, roleId, vendorId: who.vendorId, roleName: role }, env.JWT_SECRET, { expiresIn: '10m' });
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

const OTHERS = [ROLES.VENDOR_OWNER, ROLES.CUSTOMER] as const;

describe('the vendor directory and the admin vendor list', () => {
  let approved: { id: string; businessName: string } | undefined;
  let pending: { id: string } | undefined;
  before(async () => {
    [approved] = await q<{ id: string; businessName: string }>(`SELECT id, "businessName" FROM vendors WHERE status = 'APPROVED' AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`);
    [pending] = await q<{ id: string }>(`SELECT id FROM vendors WHERE status <> 'APPROVED' AND "deletedAt" IS NULL LIMIT 1`);
  });

  it('only the Super Admin reads the full admin list', async () => {
    for (const role of OTHERS) assert.equal((await call('/api/vendors?limit=3', role)).status, 403, role);
    assert.equal((await call('/api/vendors?limit=3', ROLES.SUPER_ADMIN)).status, 200);
  });

  it('the approved-vendor directory gives any signed-in user an id and a name only', async () => {
    for (const role of ROLE_KEYS) {
      const { status, data } = await call('/api/vendors/directory?limit=5', role);
      assert.equal(status, 200, role);
      assert.ok(Array.isArray(data) && data.length > 0 && data.length <= 5, `${role} gets up to 5 vendors`);
      assert.deepEqual(Object.keys(data[0]).sort(), ['businessName', 'id']);
    }
    assert.equal((await call('/api/vendors/directory?limit=3')).status, 401);
  });

  it('search and lookup by id find an approved vendor, never an unapproved one', async (t) => {
    if (!approved) return t.skip('no approved vendor');
    const fragment = encodeURIComponent(approved.businessName.slice(0, 6));
    const found = await call(`/api/vendors/directory?limit=50&search=${fragment}`, ROLES.CUSTOMER);
    assert.ok(found.data.some((v: { id: string }) => v.id === approved!.id));
    const byId = await call(`/api/vendors/directory?id=${approved.id}`, ROLES.CUSTOMER);
    assert.deepEqual(byId.data, [{ id: approved.id, businessName: approved.businessName }]);
    if (pending) assert.deepEqual((await call(`/api/vendors/directory?id=${pending.id}`, ROLES.CUSTOMER)).data, []);
    assert.equal((await call('/api/vendors/directory?id=not-a-uuid', ROLES.CUSTOMER)).status, 422);
  });
});

describe('unpublished products belong to their vendor and the platform', () => {
  let draft: { id: string } | undefined;
  before(async () => {
    [draft] = await q<{ id: string }>(
      `SELECT id FROM products WHERE status = 'DRAFT' AND "deletedAt" IS NULL AND "vendorId" IS DISTINCT FROM :own LIMIT 1`,
      { own: seller!.vendorId },
    );
  });

  it("the Super Admin opens a draft; another vendor, customers and visitors cannot", async (t) => {
    if (!draft) return t.skip('no draft product');
    const admin = await call(`/api/products/${draft.id}`, ROLES.SUPER_ADMIN);
    assert.equal(admin.status, 200);
    assert.equal(admin.data.status, 'DRAFT');
    for (const role of [...OTHERS, undefined]) {
      assert.equal((await call(`/api/products/${draft.id}`, role)).status, 404, `${role ?? 'anonymous'} must not see a draft`);
    }
  });

  it('shoppers asking for pending products get only live ones', async () => {
    for (const role of [ROLES.CUSTOMER, undefined]) {
      const { status, data } = await call('/api/products?status=PENDING_APPROVAL&limit=5', role);
      assert.equal(status, 200, role ?? 'anonymous');
      assert.ok(data.every((p: { status: string }) => p.status === 'LIVE'), `${role ?? 'anonymous'} must see only LIVE products`);
    }
  });
});

describe('shipment details', () => {
  let tracking: string | undefined;
  before(async () => {
    [{ trackingNumber: tracking } = { trackingNumber: undefined as never }] = await q<{ trackingNumber: string }>(
      `SELECT "trackingNumber" FROM shipments WHERE "trackingNumber" IS NOT NULL ORDER BY "createdAt" LIMIT 1`,
    );
  });

  it('the Super Admin sees the full record; a shopper who is not the buyer is refused; a visitor gets the carrier status', async (t) => {
    if (!tracking) return t.skip('no shipment');
    const admin = await call(`/api/shipping/tracking/${tracking}`, ROLES.SUPER_ADMIN);
    assert.equal(admin.status, 200);
    assert.ok(Object.keys(admin.data).length > 6);
    assert.equal((await call(`/api/shipping/tracking/${tracking}`, ROLES.CUSTOMER)).status, 403);
    const anonymous = await call(`/api/shipping/tracking/${tracking}`);
    assert.equal(anonymous.status, 200);
    assert.deepEqual(Object.keys(anonymous.data).sort(), ['carrier', 'estimatedDeliveryDate', 'lastUpdate', 'status', 'trackingNumber', 'trackingUrl']);
  });
});

describe('finding a user to adjust a wallet', () => {
  let target: { id: string; name: string; email: string } | undefined;
  before(async () => {
    [target] = await q<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC, email LIMIT 1`,
    );
  });

  it('finds a user by part of their email or by id, with only four fields', async (t) => {
    if (!target) return t.skip('no user');
    const byEmail = await call(`/api/admin/wallet/users?search=${encodeURIComponent(target.email.slice(0, 12))}`, ROLES.SUPER_ADMIN);
    assert.equal(byEmail.status, 200);
    assert.ok(byEmail.data.length > 0 && byEmail.data.length <= 10);
    for (const row of byEmail.data) assert.deepEqual(Object.keys(row).sort(), ['email', 'id', 'name', 'status']);
    const exact = await call(`/api/admin/wallet/users?search=${target.id}`, ROLES.SUPER_ADMIN);
    assert.deepEqual(exact.data.map((r: { id: string }) => r.id), [target.id], 'a pasted id still resolves');
  });

  it('nobody else gets the lookup, and it cannot be used to browse everyone', async () => {
    for (const role of OTHERS) assert.equal((await call('/api/admin/wallet/users?search=priya', role)).status, 403, role);
    assert.equal((await call('/api/admin/wallet/users?search=priya')).status, 401);
    assert.equal((await call('/api/admin/wallet/users?search=ab', ROLES.SUPER_ADMIN)).status, 422);
    assert.equal((await call('/api/admin/wallet/users', ROLES.SUPER_ADMIN)).status, 422);
    const wildcard = await call(`/api/admin/wallet/users?search=${encodeURIComponent('%%%')}`, ROLES.SUPER_ADMIN);
    assert.deepEqual(wildcard.data, []);
    assert.equal((await call('/api/admin/wallet/users?search=com&limit=50', ROLES.SUPER_ADMIN)).status, 422);
  });
});

describe('each role gets the data of its own job and no one else\'s', () => {
  const admin = [
    '/api/orders?limit=3', '/api/returns/admin?limit=3', '/api/support-tickets/admin?limit=3', '/api/inventory/low-stock',
    '/api/coupons?limit=3', '/api/categories', '/api/reviews/moderation?limit=3', '/api/payouts?limit=3',
    '/api/commissions?limit=3', '/api/gift-cards/admin?limit=3', '/api/cashback-offers?limit=3', '/api/users?limit=3',
  ];

  it('the Super Admin reads every admin list, with revenue', async () => {
    for (const path of admin) assert.equal((await call(path, ROLES.SUPER_ADMIN)).status, 200, path);
    const analytics = await call('/api/admin/analytics/platform', ROLES.SUPER_ADMIN);
    assert.equal(typeof analytics.data.gmv, 'number');
  });

  it('the vendor reads their own store and is refused the platform', async () => {
    for (const path of ['/api/vendors/me', '/api/suborders?limit=3', '/api/payouts?limit=3', '/api/coupons/vendor?limit=3', '/api/inventory/low-stock']) {
      assert.equal((await call(path, ROLES.VENDOR_OWNER)).status, 200, path);
    }
    for (const path of ['/api/returns/admin?limit=3', '/api/support-tickets/admin?limit=3', '/api/users?limit=3', '/api/admin/analytics/platform', '/api/gift-cards/admin?limit=3', '/api/cashback-offers?limit=3', '/api/coupons?limit=3']) {
      assert.equal((await call(path, ROLES.VENDOR_OWNER)).status, 403, path);
    }
  });

  it('a customer is refused every platform and store list', async () => {
    for (const path of ['/api/returns/admin?limit=3', '/api/users?limit=3', '/api/payouts?limit=3', '/api/suborders?limit=3', '/api/coupons?limit=3', '/api/admin/analytics/platform']) {
      assert.equal((await call(path, ROLES.CUSTOMER)).status, 403, path);
    }
  });
});

describe('the Reports hub', () => {
  const catalogFor = async (role: string) => {
    const { status, data } = await call('/api/reports/catalog', role);
    assert.equal(status, 200, role);
    return (Array.isArray(data) ? data : data?.reports ?? []) as Array<{ type: string; audience?: string }>;
  };

  it('the Super Admin has platform reports, the audit log among them', async () => {
    const types = new Set((await catalogFor(ROLES.SUPER_ADMIN)).map((r) => r.type));
    for (const type of ['order-sla', 'gmv-sales', 'wallet-liability', 'platform-analytics', 'product-performance', 'audit-log']) {
      assert.ok(types.has(type), type);
    }
  });

  it('a vendor gets store reports and no platform report', async () => {
    const types = new Set((await catalogFor(ROLES.VENDOR_OWNER)).map((r) => r.type));
    assert.ok(types.has('vendor-sales') && types.has('vendor-inventory'));
    for (const type of ['order-sla', 'gmv-sales', 'wallet-liability', 'platform-analytics', 'audit-log', 'vendor-settlement', 'staff-orders']) {
      assert.ok(!types.has(type), type);
    }
  });

  it('a customer gets only their own reports', async () => {
    const types = (await catalogFor(ROLES.CUSTOMER)).map((r) => r.type);
    assert.ok(types.length > 0 && types.every((type) => type.startsWith('customer-')), types.join());
  });
});

describe('assisted listing over HTTP (nothing here writes: every call is refused before the database changes)', () => {
  let live: { id: string; vendorId: string } | undefined;
  let pending: { id: string } | undefined;

  before(async () => {
    [live] = await q<{ id: string; vendorId: string }>(
      `SELECT id, "vendorId" FROM products WHERE status = 'LIVE' AND "vendorId" IS NOT NULL AND "vendorId" <> :own AND "deletedAt" IS NULL LIMIT 1`,
      { own: seller!.vendorId },
    );
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

  it('only the Super Admin reaches the on-behalf endpoints', async () => {
    for (const role of OTHERS) {
      assert.equal((await send('POST', '/api/products/on-behalf', role, { vendorId: randomUUID(), product: draft })).status, 403, role);
      assert.equal((await send('POST', `/api/products/${randomUUID()}/submit-on-behalf`, role, { consentNote: 'Vendor agreed by phone' })).status, 403, role);
    }
  });

  it('the vendor must be approved: an unknown or not-approved vendor is refused with 422 and nothing is created', async () => {
    for (const vendorId of [randomUUID(), pending?.id].filter(Boolean) as string[]) {
      assert.equal((await send('POST', '/api/products/on-behalf', ROLES.SUPER_ADMIN, { vendorId, product: draft })).status, 422, vendorId);
    }
    const [{ count }] = await q<{ count: string }>(`SELECT COUNT(*) AS count FROM products WHERE name = :name`, { name: draft.name });
    assert.equal(count, '0');
  });

  it('the consent note is required (10 to 500 characters)', async () => {
    for (const consentNote of [undefined, '', 'short']) {
      assert.equal((await send('POST', `/api/products/${randomUUID()}/submit-on-behalf`, ROLES.SUPER_ADMIN, { consentNote })).status, 422, String(consentNote));
    }
  });

  it("repricing another vendor's live product: a vendor gets 403; the Super Admin needs a reason (422)", async (t) => {
    if (!live || live.vendorId === seller!.vendorId) return t.skip('no live product of another vendor');
    const price = { basePrice: 1 };
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.VENDOR_OWNER, price)).status, 403);
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.SUPER_ADMIN, price)).status, 422);
    assert.equal((await send('PATCH', `/api/products/${live.id}`, ROLES.SUPER_ADMIN, { ...price, changeReason: 'short' })).status, 422);
    const variant = { sku: `ZZ-${stamp}`, price: 1 };
    assert.equal((await send('POST', `/api/products/${live.id}/variants`, ROLES.VENDOR_OWNER, variant)).status, 403);
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
    const own = await call(`/api/products/${live.id}`, ROLES.SUPER_ADMIN);
    assert.equal('listedByPlatform' in own.data, true);
  });

  it('every product needs a vendor, and an own-work reason is validated', async () => {
    const productBody = { name: `ZZ never created ${stamp}`, categoryId: randomUUID(), description: 'd', basePrice: 10 };
    assert.equal((await send('POST', '/api/products/on-behalf', ROLES.SUPER_ADMIN, { product: productBody })).status, 422);
    // The reason (10 to 500 characters) is checked before the product is even looked up.
    assert.equal((await send('POST', `/api/products/${randomUUID()}/approve`, ROLES.SUPER_ADMIN, { ownWorkReason: 'short' })).status, 422);
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

  it('GET /categories/picker: vendors and the Super Admin page through the tree with GST; customers are refused', async () => {
    for (const role of [ROLES.VENDOR_OWNER, ROLES.SUPER_ADMIN]) {
      const first = await call('/api/categories/picker?limit=5&page=1', role);
      assert.equal(first.status, 200, role);
      assert.ok(Array.isArray(first.data) && first.data.length > 0 && first.data.length <= 5);
      for (const row of first.data) {
        assert.deepEqual(Object.keys(row).sort(), ['depth', 'gstPercentage', 'gstPercentageAbove', 'id', 'imageUrl', 'name', 'path', 'priceBandThreshold']);
      }
      const second = await call('/api/categories/picker?limit=5&page=2', role);
      const ids = [...first.data, ...second.data].map((row: { id: string }) => row.id);
      assert.equal(new Set(ids).size, ids.length, 'no category on two pages');
    }
    const [{ id: firstId, name }] = (await call('/api/categories/picker?limit=1', ROLES.SUPER_ADMIN)).data;
    const byId = await call(`/api/categories/picker?id=${firstId}`, ROLES.SUPER_ADMIN);
    assert.deepEqual(byId.data.map((row: { id: string }) => row.id), [firstId]);
    const found = await call(`/api/categories/picker?search=${encodeURIComponent(String(name).slice(0, 3))}`, ROLES.SUPER_ADMIN);
    assert.ok(found.data.some((row: { id: string }) => row.id === firstId), 'search finds it');
    assert.equal((await call('/api/categories/picker?limit=51', ROLES.SUPER_ADMIN)).status, 422, 'page size is capped');
    assert.equal((await call('/api/categories/picker', ROLES.CUSTOMER)).status, 403);
    assert.equal((await call('/api/categories/picker')).status, 401, 'visitors are refused');
  });

  it('categories: the public list shows active categories only, without internal fields; the admin list is gated and carries tree, counts and GST', async () => {
    const publicList = await call('/api/categories?page=1&limit=100');
    assert.equal(publicList.status, 200);
    for (const row of publicList.data) {
      assert.notEqual(row.status, 'ARCHIVED', 'an archived category is never public');
      for (const field of ['commissionRate', 'createdBy', 'updatedBy']) assert.equal(field in row, false, `public ${field}`);
    }
    const tree = await call('/api/categories');
    assert.equal(JSON.stringify(tree.data).includes('commissionRate'), false);

    const admin = await call('/api/categories/admin?limit=5', ROLES.SUPER_ADMIN);
    assert.equal(admin.status, 200);
    for (const row of admin.data) {
      for (const field of ['depth', 'childCount', 'productCount', 'gst', 'status']) assert.ok(field in row, `${field} on admin row`);
      assert.ok(['own', 'inherited', 'default', 'fallback'].includes(row.gst.source));
    }
    for (const role of OTHERS) {
      assert.equal((await call('/api/categories/admin', role)).status, 403, role);
    }
    assert.equal((await call('/api/categories/admin')).status, 401);

    const first = await call('/api/categories/admin?limit=3&page=1', ROLES.SUPER_ADMIN);
    const second = await call('/api/categories/admin?limit=3&page=2', ROLES.SUPER_ADMIN);
    const ids = [...first.data, ...second.data].map((row: { id: string }) => row.id);
    assert.equal(new Set(ids).size, ids.length, 'no category on two pages');

    const archived = (await q<{ id: string }>(`SELECT id FROM categories WHERE status = 'ARCHIVED' LIMIT 1`))[0];
    if (archived) assert.equal((await call(`/api/categories/${archived.id}`)).status, 404, 'an archived category by id is not public');
  });

  it('tax: rules list and "where does it come from" are the Super Admin\'s, with server-side filters and counts', async () => {
    const all = await call('/api/tax/rules?limit=50', ROLES.SUPER_ADMIN);
    assert.equal(all.status, 200);
    for (const row of all.data) {
      for (const field of ['isDefault', 'appliesToCount', 'categoryId']) assert.ok(field in row, field);
    }
    const defaults = await call('/api/tax/rules?scope=default', ROLES.SUPER_ADMIN);
    assert.ok(defaults.data.every((row: { isDefault: boolean }) => row.isDefault));
    assert.ok(defaults.data.length <= 1, 'at most one default rule');
    assert.equal((await call('/api/tax/rules?hasBand=MAYBE', ROLES.SUPER_ADMIN)).status, 422);
    for (const role of OTHERS) assert.equal((await call('/api/tax/rules', role)).status, 403, `${role} cannot list rules`);

    const [category] = await q<{ id: string }>(`SELECT id FROM categories WHERE status = 'ACTIVE' LIMIT 1`);
    if (category) {
      const effective = await call(`/api/tax/rules/effective?categoryId=${category.id}`, ROLES.SUPER_ADMIN);
      assert.equal(effective.status, 200);
      assert.ok(['own', 'inherited', 'default', 'fallback'].includes(effective.data.source));
      assert.equal(typeof effective.data.gstPercentage, 'number');
      assert.equal((await call(`/api/tax/rules/effective?categoryId=${category.id}`, ROLES.VENDOR_OWNER)).status, 403);
    }
    assert.equal((await call('/api/tax/rules/effective?categoryId=nope', ROLES.SUPER_ADMIN)).status, 422);
  });

  it('the category picker is open to the people who manage categories and price products', async () => {
    for (const role of [ROLES.SUPER_ADMIN, ROLES.VENDOR_OWNER]) {
      assert.equal((await call('/api/categories/picker?limit=3', role)).status, 200, role);
    }
  });
});
