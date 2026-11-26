import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from '../permissionKeys';
import { ROLES } from '@core/constants/statuses';

const requireJs = createRequire(__filename);
const dbDir = path.resolve(__dirname, '../../../../database');

describe('team.manage permission', () => {
  it('is a registered key', () => {
    assert.equal(PERMISSIONS.TEAM_MANAGE, 'team.manage');
    assert.ok(PERMISSION_KEYS.includes('team.manage'));
  });

  it('is held by the vendor owner and super admin only', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const has = perms.includes(PERMISSIONS.TEAM_MANAGE);
      const expected = role === ROLES.VENDOR_OWNER || role === ROLES.SUPER_ADMIN;
      assert.equal(has, expected, `${role} team.manage should be ${expected}`);
    }
  });

  it('keeps owner-only separation: payout.view no longer implies team access', () => {
    assert.ok(ROLE_PERMISSIONS[ROLES.VENDOR_STAFF].every((p) => p !== PERMISSIONS.TEAM_MANAGE));
    assert.ok(ROLE_PERMISSIONS[ROLES.VENDOR_STAFF].every((p) => p !== PERMISSIONS.PAYOUT_VIEW));
  });
});

describe('roles seeder matches ROLE_PERMISSIONS (drift guard)', () => {
  it('seeds exactly the same permissions and role grants as the backend constants', async () => {
    const roleNames = new Map<string, string>();
    const permKeys = new Map<string, string>();
    const grants: { roleId: string; permissionId: string }[] = [];

    const queryInterface = {
      sequelize: { query: async () => [[]] },
      bulkInsert: async (table: string, rows: Record<string, string>[]) => {
        for (const row of rows) {
          if (table === 'roles') roleNames.set(row.id, row.name);
          if (table === 'permissions') permKeys.set(row.id, row.key);
          if (table === 'RolePermissions') grants.push({ roleId: row.roleId, permissionId: row.permissionId });
        }
      },
    };

    const seeder = requireJs(path.join(dbDir, 'seeders/20240101000001-seed-roles-permissions.js'));
    await seeder.up(queryInterface);

    assert.deepEqual([...permKeys.values()].sort(), [...PERMISSION_KEYS].sort());

    const seeded: Record<string, string[]> = {};
    for (const name of roleNames.values()) seeded[name] = [];
    for (const g of grants) seeded[roleNames.get(g.roleId)!].push(permKeys.get(g.permissionId)!);

    for (const [role, expected] of Object.entries(ROLE_PERMISSIONS)) {
      assert.deepEqual([...(seeded[role] ?? [])].sort(), [...expected].sort(), `${role} grants drifted`);
    }
  });
});

describe('20261126000001-team-manage-permission migration (SQL shape, not run against Postgres)', () => {
  const migration = requireJs(path.join(dbDir, 'migrations/20261126000001-team-manage-permission.js'));

  function fakeQueryInterface() {
    const statements: { sql: string; replacements?: Record<string, unknown> }[] = [];
    const sequelize = {
      query: async (sql: string, opts?: { replacements?: Record<string, unknown> }) => {
        statements.push({ sql, replacements: opts?.replacements });
        return [[]];
      },
      transaction: async (cb: (t: unknown) => Promise<void>) => cb({}),
    };
    return { statements, queryInterface: { sequelize } };
  }

  it('up: inserts the key and grants it to VENDOR_OWNER only, both guarded by NOT EXISTS', async () => {
    const { statements, queryInterface } = fakeQueryInterface();
    await migration.up(queryInterface);
    assert.equal(statements.length, 2);
    const [insertPerm, grant] = statements.map((s) => s.sql);
    assert.match(insertPerm, /INSERT INTO permissions/);
    assert.match(insertPerm, /'team\.manage'/);
    assert.match(insertPerm, /NOT EXISTS/);
    assert.match(grant, /INSERT INTO "RolePermissions"/);
    assert.match(grant, /r\.name = 'VENDOR_OWNER'/);
    assert.match(grant, /p\.key = 'team\.manage'/);
    assert.match(grant, /NOT EXISTS/);
    assert.doesNotMatch(grant, /VENDOR_STAFF|ADMIN_/);
  });

  it('down: removes the grants before the permission row', async () => {
    const { statements, queryInterface } = fakeQueryInterface();
    await migration.down(queryInterface);
    assert.equal(statements.length, 1);
    const sql = statements[0].sql;
    assert.ok(sql.indexOf('DELETE FROM "RolePermissions"') < sql.indexOf('DELETE FROM permissions'));
    assert.match(sql, /'team\.manage'/);
  });
});
