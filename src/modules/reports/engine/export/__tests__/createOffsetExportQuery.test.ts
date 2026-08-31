import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createOffsetExportQuery,
  createSingleShotExportQuery,
} from '../createOffsetExportQuery';

describe('createOffsetExportQuery', () => {
  it('pages through query results and skips COUNT after page 1', async () => {
    let countCalls = 0;
    const queryFn = async (filters: {
      page?: number;
      limit?: number;
      _exportSkipCount?: boolean;
      _exportKnownTotal?: number;
    }) => {
      if (!filters._exportSkipCount) countCalls += 1;
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 2;
      return {
        rows: [{ id: `${page}` }],
        total: 3,
      };
    };
    const exportQuery = createOffsetExportQuery(queryFn);
    const first = await exportQuery(
      { from: new Date(), to: new Date(), page: 1, limit: 2 },
      null,
      2,
    );
    assert.equal(first.rows.length, 1);
    assert.deepEqual(first.nextCursor, { values: [2, 3] });

    const second = await exportQuery(
      { from: new Date(), to: new Date(), page: 1, limit: 2 },
      first.nextCursor,
      2,
    );
    assert.equal(second.rows.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(countCalls, 1);
  });

  it('single-shot export runs query once', async () => {
    let calls = 0;
    const queryFn = async () => {
      calls += 1;
      return { rows: [{ metric: 'gmv', value: 1 }], total: 1 };
    };
    const exportQuery = createSingleShotExportQuery(queryFn);
    const first = await exportQuery({ from: new Date(), to: new Date() }, null, 100);
    const second = await exportQuery({ from: new Date(), to: new Date() }, { values: [1] }, 100);
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 0);
    assert.equal(calls, 1);
  });
});
