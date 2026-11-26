import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import type { NextFunction, Request, Response, Router } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { WALLET_USER_SEARCH_MAX_RESULTS, WALLET_USER_SEARCH_MIN, WalletUserSearchSchema } from '../wallet.admin.dto';
import { walletAdminService } from '../wallet.admin.service';

describe('WalletUserSearchSchema', () => {
  it('trims, requires 3+ characters, and caps the result count', () => {
    assert.equal(WalletUserSearchSchema.parse({ search: '  priya  ' }).search, 'priya');
    assert.equal(WalletUserSearchSchema.parse({ search: 'abc' }).limit, WALLET_USER_SEARCH_MAX_RESULTS);
    assert.equal(WalletUserSearchSchema.parse({ search: 'abc', limit: '5' }).limit, 5);
    for (const bad of [{}, { search: '' }, { search: 'ab' }, { search: '  a ' }, { search: 'x'.repeat(101) }, { search: 'abc', limit: 11 }, { search: 'abc', limit: 0 }]) {
      assert.equal(WalletUserSearchSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
    assert.equal(WALLET_USER_SEARCH_MIN, 3);
  });
});

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...a: unknown[]) => unknown }[] } };

describe('GET /admin/wallet/users guard', () => {
  let router: Router;
  before(async () => {
    router = (await import('../wallet.admin.routes')).default;
  });
  afterEach(() => clearPermissionCache());

  async function guard(role: string, permissions: string[]) {
    const layer = (router as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/users' && l.route.methods.get);
    assert.ok(layer?.route, 'GET /users must exist');
    setPermissionCache(`role-${role}`, permissions);
    let outcome: unknown = 'not-called';
    await layer.route.stack[1]!.handle({ user: { id: 'u', roleId: `role-${role}`, role: { name: role } } } as unknown as Request, {} as Response, ((e?: unknown) => {
      outcome = e;
    }) as NextFunction);
    return outcome;
  }
  const forbidden = (o: unknown) => (o as { statusCode?: number } | undefined)?.statusCode === 403;

  it('is open to Super Admin and the Finance Manager (wallet.adjust) and a custom role granted it', async () => {
    assert.equal(await guard(ROLES.SUPER_ADMIN, [...ROLE_PERMISSIONS[ROLES.SUPER_ADMIN]!]), undefined);
    assert.equal(await guard(ROLES.ADMIN_FINANCE_MANAGER, [...ROLE_PERMISSIONS[ROLES.ADMIN_FINANCE_MANAGER]!]), undefined);
    assert.equal(await guard('GIFT_CARD_DESK', ['wallet.adjust']), undefined);
  });

  it('refuses everyone else, including the managers and anyone with only user.manage-less permissions', async () => {
    for (const role of [ROLES.ADMIN_ORDER_MANAGER, ROLES.ADMIN_CATALOG_MANAGER, ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF, ROLES.CUSTOMER]) {
      assert.ok(forbidden(await guard(role, [...ROLE_PERMISSIONS[role]!])), role);
    }
    assert.ok(forbidden(await guard('ANALYST', ['analytics.view', 'gift_card.manage'])));
  });
});

describe('walletAdminService.searchUsers (real database)', () => {
  const created: string[] = [];
  const stamp = Date.now().toString(36);
  let anyRoleId = '';
  let customer: { id: string; name: string; email: string } | undefined;

  before(async () => {
    const [role] = await sequelize.query<{ id: string }>(`SELECT id FROM roles WHERE name = 'CUSTOMER' LIMIT 1`, { type: QueryTypes.SELECT });
    anyRoleId = role?.id ?? '';
    [customer] = await sequelize.query<{ id: string; name: string; email: string }>(
      `SELECT u.id, u.name, u.email FROM users u JOIN roles r ON r.id = u."roleId"
       WHERE r.name = 'CUSTOMER' AND u."deletedAt" IS NULL AND length(u.email) > 12 ORDER BY u."createdAt" LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
  });
  after(async () => {
    if (created.length) await sequelize.query(`DELETE FROM users WHERE id IN (:ids)`, { replacements: { ids: created } });
  });

  async function insertUser(name: string, email: string, deleted = false) {
    const id = randomUUID();
    await sequelize.query(
      `INSERT INTO users (id, email, "passwordHash", name, "roleId", status, "emailVerified", "createdAt", "updatedAt", "deletedAt")
       VALUES (:id, :email, 'x', :name, :roleId, 'ACTIVE', true, NOW(), NOW(), ${deleted ? 'NOW()' : 'NULL'})`,
      { replacements: { id, email, name, roleId: anyRoleId } },
    );
    created.push(id);
    return id;
  }

  it('finds an account by part of its email or name, case-insensitively, with only four fields', async (t) => {
    if (!customer) return t.skip('no customer in the database');
    const byEmail = await walletAdminService.searchUsers({ search: customer.email.slice(2, 10).toUpperCase(), limit: 10 });
    assert.ok(byEmail.some((u) => u.id === customer!.id), 'found by an email fragment');
    const byName = await walletAdminService.searchUsers({ search: customer.name.slice(0, 4).toLowerCase(), limit: 10 });
    assert.ok(byName.some((u) => u.id === customer!.id), 'found by a name fragment');
    for (const row of [...byEmail, ...byName]) {
      assert.deepEqual(Object.keys(row).sort(), ['email', 'id', 'name', 'status'], 'no other field is revealed');
    }
  });

  it('accepts a pasted user id (exact match) so the old workflow still works', async (t) => {
    if (!customer) return t.skip('no customer in the database');
    const rows = await walletAdminService.searchUsers({ search: customer.id, limit: 10 });
    assert.deepEqual(rows.map((r) => r.id), [customer.id]);
  });

  it('caps the result count', async () => {
    const rows = await walletAdminService.searchUsers({ search: 'a@', limit: 3 });
    assert.ok(rows.length <= 3);
  });

  it('treats % and _ literally: a wildcard cannot be used to list everyone', async () => {
    assert.deepEqual(await walletAdminService.searchUsers({ search: '%%%', limit: 10 }), []);
    assert.deepEqual(await walletAdminService.searchUsers({ search: '___', limit: 10 }), []);
    const literal = await insertUser(`Pct ${stamp}`, `100%off-${stamp}@example.test`);
    const hit = await walletAdminService.searchUsers({ search: '100%off-' + stamp, limit: 10 });
    assert.deepEqual(hit.map((r) => r.id), [literal], 'a literal percent sign in a real email still matches');
  });

  it('never returns a soft-deleted account', async (t) => {
    if (!anyRoleId) return t.skip('no CUSTOMER role');
    const suffix = `${stamp}-del`;
    const live = await insertUser(`Live ${suffix}`, `lookup-live-${suffix}@example.test`);
    await insertUser(`Gone ${suffix}`, `lookup-gone-${suffix}@example.test`, true);
    const rows = await walletAdminService.searchUsers({ search: `-${suffix}@example.test`, limit: 10 });
    assert.deepEqual(rows.map((r) => r.id), [live]);
  });

  it('returns nothing, not everything, for a term nobody matches', async () => {
    assert.deepEqual(await walletAdminService.searchUsers({ search: `zz-nobody-${stamp}-zz`, limit: 10 }), []);
  });
});
