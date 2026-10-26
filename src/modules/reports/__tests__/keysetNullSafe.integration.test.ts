import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sequelize } from '@database/models';
import { keysetSqlQuery, type KeysetCursor } from '../engine/export/keysetSqlQuery';

describe('keyset paging over NULL and tied sort keys', () => {
  it('returns every row exactly once, chunk by chunk', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    // Platform rows have no vendorId; several rows share a GMV.
    const selectSql = `
      SELECT * FROM (VALUES
        (500, 'v-a'), (500, NULL), (500, 'v-b'), (300, NULL), (300, 'v-c'), (100, 'v-d'), (100, NULL)
      ) AS rows("gmvPaise", "vendorId")`;
    const order = [
      { column: 'gmvPaise', direction: 'DESC' as const },
      { column: 'vendorId', direction: 'ASC' as const },
    ];
    const seen: string[] = [];
    let cursor: KeysetCursor | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await keysetSqlQuery({
        selectSql,
        order,
        replacements: {},
        limit: 2,
        cursor,
        mapRow: (row) => row,
      });
      seen.push(...page.rows.map((row) => `${row.gmvPaise}:${row.vendorId ?? 'null'}`));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, ['500:v-a', '500:v-b', '500:null', '300:v-c', '300:null', '100:v-d', '100:null']);
  });
});
