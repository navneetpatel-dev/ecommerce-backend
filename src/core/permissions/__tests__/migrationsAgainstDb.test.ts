import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';

/**
 * Runs the real SQL of the data migrations from this security work against the real database,
 * inside a transaction that is always rolled back, so nothing persists. Skipped when no database
 * is reachable (the SQL-shape tests next to these still run).
 */
const requireJs = createRequire(__filename);
const migrationsDir = path.resolve(__dirname, '../../../../database/migrations');
const load = (file: string) => requireJs(path.join(migrationsDir, file)) as {
  up: (qi: unknown) => Promise<void>;
  down: (qi: unknown) => Promise<void>;
};

let dbUp = false;
before(async () => {
  try {
    await sequelize.authenticate();
    dbUp = true;
  } catch {
    dbUp = false;
  }
});

async function inRolledBackTransaction(fn: (tx: Transaction, qi: unknown) => Promise<void>) {
  const tx = await sequelize.transaction();
  // The migrations open their own transaction and pass it to every query: route both into ours.
  const qi = {
    sequelize: {
      transaction: async (cb: (t: Transaction) => Promise<unknown>) => cb(tx),
      query: (sql: string, opts: Record<string, unknown> = {}) => sequelize.query(sql, { ...opts, transaction: tx }),
    },
  };
  try {
    await fn(tx, qi);
  } finally {
    await tx.rollback();
  }
}

const select = <T>(tx: Transaction, sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(sql, { transaction: tx, replacements, type: QueryTypes.SELECT });

async function ensureRole(tx: Transaction, name: string): Promise<string> {
  const [row] = await select<{ id: string }>(tx, `SELECT id FROM roles WHERE name = :name LIMIT 1`, { name });
  if (row) return row.id;
  const id = randomUUID();
  await sequelize.query(`INSERT INTO roles (id, name, "createdAt", "updatedAt") VALUES (:id, :name, NOW(), NOW())`, {
    transaction: tx,
    replacements: { id, name },
  });
  return id;
}

async function ensurePermission(tx: Transaction, key: string): Promise<string> {
  const [row] = await select<{ id: string }>(tx, `SELECT id FROM permissions WHERE key = :key LIMIT 1`, { key });
  if (row) return row.id;
  const id = randomUUID();
  await sequelize.query(`INSERT INTO permissions (id, key, "createdAt", "updatedAt") VALUES (:id, :key, NOW(), NOW())`, {
    transaction: tx,
    replacements: { id, key },
  });
  return id;
}

async function grant(tx: Transaction, roleId: string, permissionId: string) {
  await sequelize.query(
    `INSERT INTO "RolePermissions" ("roleId", "permissionId", "createdAt", "updatedAt")
     SELECT :roleId, :permissionId, NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM "RolePermissions" WHERE "roleId" = :roleId AND "permissionId" = :permissionId)`,
    { transaction: tx, replacements: { roleId, permissionId } },
  );
}

const rolesHolding = async (tx: Transaction, key: string) =>
  (
    await select<{ name: string }>(
      tx,
      `SELECT r.name FROM "RolePermissions" rp
       JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId"
       WHERE p.key = :key ORDER BY r.name`,
      { key },
    )
  ).map((r) => r.name);

const countPermission = async (tx: Transaction, key: string) =>
  (await select<{ n: number }>(tx, `SELECT count(*)::int AS n FROM permissions WHERE key = :key`, { key }))[0]!.n;

describe('20261126000001-team-manage-permission (real SQL, rolled back)', () => {
  const migration = load('20261126000001-team-manage-permission.js');

  it('adds team.manage once and grants it to VENDOR_OWNER only; safe to run twice; down removes it', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      await ensureRole(tx, 'VENDOR_OWNER');
      await ensureRole(tx, 'VENDOR_STAFF');
      // Start from the pre-migration state regardless of what the dev database already holds.
      await sequelize.query(
        `DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = 'team.manage')`,
        { transaction: tx },
      );
      await sequelize.query(`DELETE FROM permissions WHERE key = 'team.manage'`, { transaction: tx });

      await migration.up(qi);
      assert.equal(await countPermission(tx, 'team.manage'), 1);
      assert.deepEqual(await rolesHolding(tx, 'team.manage'), ['VENDOR_OWNER']);

      await migration.up(qi); // idempotent
      assert.equal(await countPermission(tx, 'team.manage'), 1);
      assert.deepEqual(await rolesHolding(tx, 'team.manage'), ['VENDOR_OWNER']);

      await migration.down(qi);
      assert.equal(await countPermission(tx, 'team.manage'), 0);
      assert.deepEqual(await rolesHolding(tx, 'team.manage'), []);
    });
  });
});

describe('20261126000002-revoke-manager-audit-view (real SQL, rolled back)', () => {
  const migration = load('20261126000002-revoke-manager-audit-view.js');

  it('revokes audit.view from the two managers only; custom roles and Super Admin keep it; down restores managers', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      const audit = await ensurePermission(tx, 'audit.view');
      const customName = `ZZ_AUDITOR_${Date.now()}`;
      const roles = {
        orderMgr: await ensureRole(tx, 'ADMIN_ORDER_MANAGER'),
        catalogMgr: await ensureRole(tx, 'ADMIN_CATALOG_MANAGER'),
        superAdmin: await ensureRole(tx, 'SUPER_ADMIN'),
        custom: await ensureRole(tx, customName),
      };
      for (const id of Object.values(roles)) await grant(tx, id, audit);

      await migration.up(qi);
      const afterUp = await rolesHolding(tx, 'audit.view');
      assert.ok(!afterUp.includes('ADMIN_ORDER_MANAGER'), 'order manager must lose audit.view');
      assert.ok(!afterUp.includes('ADMIN_CATALOG_MANAGER'), 'catalog manager must lose audit.view');
      assert.ok(afterUp.includes('SUPER_ADMIN'), 'super admin keeps audit.view');
      assert.ok(afterUp.includes(customName), 'custom roles keep audit.view');

      await migration.up(qi); // idempotent
      assert.deepEqual(await rolesHolding(tx, 'audit.view'), afterUp);

      await migration.down(qi);
      const afterDown = await rolesHolding(tx, 'audit.view');
      assert.ok(afterDown.includes('ADMIN_ORDER_MANAGER') && afterDown.includes('ADMIN_CATALOG_MANAGER'));
      await migration.down(qi); // re-granting twice adds no duplicates
      assert.deepEqual(await rolesHolding(tx, 'audit.view'), afterDown);
    });
  });
});

describe('20261126000003-sanitize-short-links (real SQL, rolled back)', () => {
  const migration = load('20261126000003-sanitize-short-links.js');

  const insert = (tx: Transaction, code: string, targetUrl: string, metadata: object | null) =>
    sequelize.query(
      `INSERT INTO short_links (code, "targetUrl", "resourceType", metadata, clicks, "createdAt", "updatedAt")
       VALUES (:code, :targetUrl, 'PRODUCT', CAST(:metadata AS jsonb), 0, NOW(), NOW())`,
      {
        transaction: tx,
        replacements: { code, targetUrl, metadata: metadata ? JSON.stringify(metadata) : null },
      },
    );

  it('rewrites off-site / unsafe targets to "/", keeps good ones, drops stored preview text; safe to run twice', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      const stamp = Date.now().toString(36);
      const cases: [string, string, string][] = [
        // [code, stored target, expected target]
        [`a${stamp}`, '//evil.com', '/'],
        [`b${stamp}`, '/\\evil.com', '/'],
        [`c${stamp}`, 'javascript:alert(1)', '/'],
        [`d${stamp}`, 'evil.com', '/'],
        [`e${stamp}`, 'https://evil.com/x', '/'],
        [`f${stamp}`, '/a</script><script>alert(1)', '/'],
        [`g${stamp}`, '/a"b', '/'],
        [`h${stamp}`, "/a'b", '/'],
        [`i${stamp}`, '/a b', '/'],
        [`j${stamp}`, '/a\tb', '/'],
        [`k${stamp}`, `/${'x'.repeat(2100)}`, '/'],
        [`l${stamp}`, '/', '/'],
        [`m${stamp}`, '/products/blue-shirt', '/products/blue-shirt'],
        [`n${stamp}`, '/category/men?sort=price&page=2', '/category/men?sort=price&page=2'],
        [`o${stamp}`, '/products/a%20b', '/products/a%20b'],
      ];
      for (const [code, target] of cases) {
        await insert(tx, code, target, { name: 'FAKE', price: 1 });
      }

      await migration.up(qi);
      await migration.up(qi); // idempotent

      const rows = await select<{ code: string; targetUrl: string; metadata: unknown }>(
        tx,
        `SELECT code, "targetUrl", metadata FROM short_links WHERE code IN (:codes)`,
        { codes: cases.map(([c]) => c) },
      );
      assert.equal(rows.length, cases.length);
      for (const [code, stored, expected] of cases) {
        const row = rows.find((r) => r.code === code)!;
        assert.equal(row.targetUrl, expected, `target ${JSON.stringify(stored.slice(0, 30))}`);
        assert.equal(row.metadata, null, `metadata must be cleared for ${code}`);
      }
    });
  });

  it('leaves no trace once rolled back', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    const code = `zz${Date.now().toString(36)}`;
    await inRolledBackTransaction(async (tx) => {
      await insert(tx, code, '//evil.com', null);
    });
    const [row] = await sequelize.query<{ n: number }>(`SELECT count(*)::int AS n FROM short_links WHERE code = :code`, {
      replacements: { code },
      type: QueryTypes.SELECT,
    });
    assert.equal(row!.n, 0);
  });
});

describe('20261126000004-revoke-order-manager-bug-reports (real SQL, rolled back)', () => {
  const migration = load('20261126000004-revoke-order-manager-bug-reports.js');

  it('revokes bug_report.manage from the Order Manager only; others keep it; down restores only the Order Manager', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      const bug = await ensurePermission(tx, 'bug_report.manage');
      const customName = `ZZ_SUPPORT_LEAD_${Date.now()}`;
      const roles = {
        orderMgr: await ensureRole(tx, 'ADMIN_ORDER_MANAGER'),
        catalogMgr: await ensureRole(tx, 'ADMIN_CATALOG_MANAGER'),
        superAdmin: await ensureRole(tx, 'SUPER_ADMIN'),
        custom: await ensureRole(tx, customName),
      };
      for (const id of Object.values(roles)) await grant(tx, id, bug);

      await migration.up(qi);
      const afterUp = await rolesHolding(tx, 'bug_report.manage');
      assert.ok(!afterUp.includes('ADMIN_ORDER_MANAGER'), 'order manager must lose bug_report.manage');
      assert.ok(afterUp.includes('SUPER_ADMIN'), 'super admin keeps it');
      assert.ok(afterUp.includes(customName), 'an explicitly granted custom role keeps it');
      assert.ok(afterUp.includes('ADMIN_CATALOG_MANAGER'), 'the migration touches the Order Manager only');

      await migration.up(qi); // idempotent
      assert.deepEqual(await rolesHolding(tx, 'bug_report.manage'), afterUp);

      await migration.down(qi);
      const afterDown = await rolesHolding(tx, 'bug_report.manage');
      assert.ok(afterDown.includes('ADMIN_ORDER_MANAGER'));
      await migration.down(qi); // no duplicate grants
      assert.deepEqual(await rolesHolding(tx, 'bug_report.manage'), afterDown);
    });
  });
});

describe('20261126000005-revoke-order-manager-wallet-adjust (real SQL, rolled back)', () => {
  const migration = load('20261126000005-revoke-order-manager-wallet-adjust.js');

  it('revokes wallet.adjust from the Order Manager only; Super Admin and custom roles keep it; down restores only the Order Manager', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      const perm = await ensurePermission(tx, 'wallet.adjust');
      const customName = `ZZ_GIFT_DESK_${Date.now()}`;
      const roles = {
        orderMgr: await ensureRole(tx, 'ADMIN_ORDER_MANAGER'),
        catalogMgr: await ensureRole(tx, 'ADMIN_CATALOG_MANAGER'),
        superAdmin: await ensureRole(tx, 'SUPER_ADMIN'),
        custom: await ensureRole(tx, customName),
      };
      for (const id of Object.values(roles)) await grant(tx, id, perm);

      await migration.up(qi);
      const afterUp = await rolesHolding(tx, 'wallet.adjust');
      assert.ok(!afterUp.includes('ADMIN_ORDER_MANAGER'), 'order manager must lose wallet.adjust');
      assert.ok(afterUp.includes('SUPER_ADMIN') && afterUp.includes(customName) && afterUp.includes('ADMIN_CATALOG_MANAGER'), 'nobody else is touched');

      await migration.up(qi); // idempotent
      assert.deepEqual(await rolesHolding(tx, 'wallet.adjust'), afterUp);

      await migration.down(qi);
      assert.ok((await rolesHolding(tx, 'wallet.adjust')).includes('ADMIN_ORDER_MANAGER'));
      const once = await rolesHolding(tx, 'wallet.adjust');
      await migration.down(qi); // no duplicate grants
      assert.deepEqual(await rolesHolding(tx, 'wallet.adjust'), once);
    });
  });
});

describe('20261126000006-cashback-and-webvitals-permissions (real SQL, rolled back)', () => {
  const migration = load('20261126000006-cashback-and-webvitals-permissions.js');
  const KEYS = ['cashback.manage', 'webvitals.view'];

  it('adds both permissions once, grants them to SUPER_ADMIN only, is idempotent, and down removes them', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      for (const name of ['SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER']) await ensureRole(tx, name);
      // Start from the pre-migration state regardless of what the dev database already holds.
      for (const key of KEYS) {
        await sequelize.query(`DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = :key)`, { transaction: tx, replacements: { key } });
        await sequelize.query(`DELETE FROM permissions WHERE key = :key`, { transaction: tx, replacements: { key } });
      }

      await migration.up(qi);
      await migration.up(qi); // idempotent
      for (const key of KEYS) {
        assert.equal(await countPermission(tx, key), 1, `${key} exists exactly once`);
        assert.deepEqual(await rolesHolding(tx, key), ['SUPER_ADMIN'], `${key} is held by SUPER_ADMIN only`);
      }

      await migration.down(qi);
      for (const key of KEYS) {
        assert.equal(await countPermission(tx, key), 0);
        assert.deepEqual(await rolesHolding(tx, key), []);
      }
    });
  });
});

describe('20261126000007-finance-role-and-revenue-permissions (real SQL, rolled back)', () => {
  const migration = load('20261126000007-finance-role-and-revenue-permissions.js');
  const NEW = ['analytics.revenue', 'coupon.unlimited'];
  const FINANCE_KEYS = ['payout.manage', 'commission.view', 'analytics.view', 'analytics.revenue', 'wallet.adjust', 'cashback.manage', 'gift_card.manage'];

  const permissionsOf = async (tx: Transaction, role: string) =>
    (
      await select<{ key: string }>(
        tx,
        `SELECT p.key FROM "RolePermissions" rp
         JOIN roles r ON r.id = rp."roleId" JOIN permissions p ON p.id = rp."permissionId"
         WHERE r.name = :role ORDER BY p.key`,
        { role },
      )
    ).map((r) => r.key);
  const roleCount = async (tx: Transaction, name: string) =>
    (await select<{ n: number }>(tx, `SELECT count(*)::int AS n FROM roles WHERE name = :name`, { name }))[0]!.n;

  it('adds the permissions, creates the Finance role with its grants, moves Gift Cards off the Order Manager; idempotent; down reverses it', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      const superAdmin = await ensureRole(tx, 'SUPER_ADMIN');
      const orderMgr = await ensureRole(tx, 'ADMIN_ORDER_MANAGER');
      const customName = `ZZ_GIFT_DESK_${Date.now()}`;
      const custom = await ensureRole(tx, customName);
      for (const key of FINANCE_KEYS.filter((k) => !NEW.includes(k))) await ensurePermission(tx, key);

      // Start from the pre-migration state regardless of what the dev database already holds.
      for (const key of NEW) {
        await sequelize.query(`DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM permissions WHERE key = :key)`, { transaction: tx, replacements: { key } });
        await sequelize.query(`DELETE FROM permissions WHERE key = :key`, { transaction: tx, replacements: { key } });
      }
      await sequelize.query(`DELETE FROM "RolePermissions" WHERE "roleId" IN (SELECT id FROM roles WHERE name = 'ADMIN_FINANCE_MANAGER')`, { transaction: tx });
      await sequelize.query(`DELETE FROM roles WHERE name = 'ADMIN_FINANCE_MANAGER' AND NOT EXISTS (SELECT 1 FROM users u WHERE u."roleId" = roles.id)`, { transaction: tx });
      const gift = await ensurePermission(tx, 'gift_card.manage');
      await grant(tx, orderMgr, gift);
      await grant(tx, custom, gift);
      assert.ok((await rolesHolding(tx, 'gift_card.manage')).includes('ADMIN_ORDER_MANAGER'), 'precondition');

      await migration.up(qi);
      await migration.up(qi); // idempotent

      for (const key of NEW) {
        assert.equal(await countPermission(tx, key), 1, `${key} exists once`);
        assert.ok((await rolesHolding(tx, key)).includes('SUPER_ADMIN'), `${key} held by Super Admin`);
        assert.ok(!(await rolesHolding(tx, key)).includes('ADMIN_FINANCE_MANAGER') || key === 'analytics.revenue', `${key} grant check`);
      }
      assert.deepEqual(await rolesHolding(tx, 'coupon.unlimited'), ['SUPER_ADMIN'], 'coupon.unlimited is Super Admin only');

      assert.equal(await roleCount(tx, 'ADMIN_FINANCE_MANAGER'), 1, 'the Finance role exists exactly once');
      assert.deepEqual(await permissionsOf(tx, 'ADMIN_FINANCE_MANAGER'), [...FINANCE_KEYS].sort());

      const giftHolders = await rolesHolding(tx, 'gift_card.manage');
      assert.ok(!giftHolders.includes('ADMIN_ORDER_MANAGER'), 'the Order Manager loses gift_card.manage');
      assert.ok(giftHolders.includes('ADMIN_FINANCE_MANAGER') && giftHolders.includes(customName), 'Finance and custom roles keep it');

      await migration.down(qi);
      for (const key of NEW) assert.equal(await countPermission(tx, key), 0, `${key} removed`);
      assert.equal(await roleCount(tx, 'ADMIN_FINANCE_MANAGER'), 0, 'the empty Finance role is dropped');
      assert.ok((await rolesHolding(tx, 'gift_card.manage')).includes('ADMIN_ORDER_MANAGER'), 'the Order Manager regains gift_card.manage');
      void superAdmin;
    });
  });

  it('down leaves a Finance role that already has users in place instead of failing the rollback', async (t) => {
    if (!dbUp) return t.skip('database not reachable');
    await inRolledBackTransaction(async (tx, qi) => {
      await ensureRole(tx, 'SUPER_ADMIN');
      for (const key of FINANCE_KEYS.filter((k) => !NEW.includes(k))) await ensurePermission(tx, key);
      await migration.up(qi);
      const [finance] = await select<{ id: string }>(tx, `SELECT id FROM roles WHERE name = 'ADMIN_FINANCE_MANAGER'`);
      const [anyUser] = await select<{ id: string }>(tx, `SELECT id FROM users LIMIT 1`);
      if (!anyUser) return t.skip('no user row to attach to the role');
      await sequelize.query(`UPDATE users SET "roleId" = :roleId WHERE id = :id`, { transaction: tx, replacements: { roleId: finance!.id, id: anyUser.id } });
      await migration.down(qi);
      assert.equal(await roleCount(tx, 'ADMIN_FINANCE_MANAGER'), 1, 'a role with users is kept');
    });
  });
});
