import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExportKey } from '../exportKey';
import { buildKeysetPredicate } from '../keysetSqlQuery';

describe('exportKey', () => {
  it('is stable regardless of filter key insertion order', () => {
    const a = buildExportKey({
      userId: 'u1',
      reportType: 'gmv-sales',
      format: 'csv',
      filtersUsed: { from: 'a', to: 'b', vendorId: null, reportsPath: '/x' },
    });
    const b = buildExportKey({
      userId: 'u1',
      reportType: 'gmv-sales',
      format: 'csv',
      filtersUsed: { reportsPath: '/y', vendorId: null, to: 'b', from: 'a' },
    });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it('changes when format or user changes', () => {
    const base = {
      userId: 'u1',
      reportType: 'gmv-sales',
      filtersUsed: { from: 'a', to: 'b' },
      format: 'csv' as const,
    };
    assert.notEqual(buildExportKey(base), buildExportKey({ ...base, format: 'xlsx' }));
    assert.notEqual(buildExportKey(base), buildExportKey({ ...base, userId: 'u2' }));
  });
});

describe('keyset predicate', () => {
  it('builds mixed-direction OR equality chain', () => {
    const pred = buildKeysetPredicate(
      [
        { column: 'gmvPaise', direction: 'DESC' },
        { column: 'vendorId', direction: 'ASC' },
      ],
      { values: [100, 'abc'] },
    );
    assert.match(pred.sql, /"gmvPaise" < :ks_0/);
    assert.match(pred.sql, /"gmvPaise" = :ks_0 AND "vendorId" > :ks_1/);
    assert.equal(pred.replacements.ks_0, 100);
    assert.equal(pred.replacements.ks_1, 'abc');
  });
});
