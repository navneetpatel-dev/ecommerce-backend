import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExportKey } from '../exportKey';
import { createReportRowIterator } from '../ReportRowIterator';
import type { ReportDefinition, ReportFilters } from '../../types';

describe('report export pipeline', () => {
  it('buildExportKey is stable for equivalent filter payloads', () => {
    const base = {
      userId: 'user-1',
      reportType: 'gmv-sales',
      format: 'xlsx' as const,
      filtersUsed: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
        vendorId: null,
        page: 1,
        limit: 50,
        reportsPath: '/admin/reports',
      },
    };
    const a = buildExportKey(base);
    const b = buildExportKey({
      ...base,
      filtersUsed: {
        reportsPath: '/admin/reports',
        limit: 50,
        page: 1,
        vendorId: null,
        to: '2026-01-31T23:59:59.999Z',
        from: '2026-01-01T00:00:00.000Z',
      },
    });
    assert.equal(a, b);
    assert.notEqual(
      a,
      buildExportKey({
        ...base,
        format: 'csv',
      }),
    );
  });

  it('createReportRowIterator prefers exportQuery over offset paging', async () => {
    let offsetCalls = 0;
    let keysetCalls = 0;
    const filters: ReportFilters = {
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    };
    const def: ReportDefinition = {
      type: 'mock-export',
      labelKey: 'reports',
      audience: 'admin_finance',
      permissions: [],
      vendorScoped: false,
      financial: false,
      columns: [{ key: 'id', labelKey: 'uuidPlaceholder' }],
      query: async () => {
        offsetCalls += 1;
        return { rows: [{ id: 'offset' }], total: 1 };
      },
      exportQuery: async () => {
        keysetCalls += 1;
        return {
          rows: [{ id: 'keyset-1' }, { id: 'keyset-2' }],
          nextCursor: null,
        };
      },
    };

    const chunks: Record<string, unknown>[][] = [];
    for await (const chunk of createReportRowIterator(def, filters)) {
      chunks.push(chunk);
    }

    assert.equal(offsetCalls, 0);
    assert.equal(keysetCalls, 1);
    assert.deepEqual(chunks, [[{ id: 'keyset-1' }, { id: 'keyset-2' }]]);
  });

  it('createReportRowIterator skips COUNT when knownTotal is provided', async () => {
    let countProbes = 0;
    const def: ReportDefinition = {
      type: 'mock-offset',
      labelKey: 'reports',
      audience: 'admin_finance',
      permissions: [],
      vendorScoped: false,
      financial: false,
      columns: [{ key: 'id', labelKey: 'uuidPlaceholder' }],
      query: async (filters) => {
        if (!filters._exportSkipCount) countProbes += 1;
        return {
          rows: [{ id: String(filters.page ?? 1) }],
          total: 2,
        };
      },
    };

    const chunks: Record<string, unknown>[][] = [];
    for await (const chunk of createReportRowIterator(
      def,
      { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
      2,
    )) {
      chunks.push(chunk);
    }

    assert.equal(countProbes, 0);
    assert.equal(chunks.length, 1);
  });
});
