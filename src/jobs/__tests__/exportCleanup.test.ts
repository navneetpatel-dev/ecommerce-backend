import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { ExportJob } from '@database/models/exportJob.model';
import { exportConfig } from '@core/export';
import { runStaleProcessingSweep } from '../exportCleanup';

describe('runStaleProcessingSweep', () => {
  afterEach(() => mock.restoreAll());

  it('force-fails PROCESSING rows whose updatedAt is older than 2 × maxInactivityMs', async () => {
    const update = mock.method(ExportJob, 'update', async () => [2]);
    const result = await runStaleProcessingSweep();
    assert.equal(result.failed, 2);
    assert.equal(update.mock.callCount(), 1);
    const [values, options] = update.mock.calls[0]?.arguments as [
      { status: string; errorCode: string },
      { where: { status: string; updatedAt: { [key: symbol]: Date } } },
    ];
    assert.equal(values.status, 'FAILED');
    assert.equal(values.errorCode, 'EXPORT_STUCK');
    assert.equal(options.where.status, 'PROCESSING');
    const staleOp = options.where.updatedAt;
    const staleBefore = staleOp[Object.getOwnPropertySymbols(staleOp)[0]!] as Date;
    const expected = Date.now() - 2 * exportConfig.maxInactivityMs;
    assert.ok(Math.abs(staleBefore.getTime() - expected) < 2_000);
  });

  it('leaves a recently-updated PROCESSING row untouched even if startedAt is very old', async () => {
    mock.method(ExportJob, 'update', async (_values, options: { where: { updatedAt: Record<symbol, Date> } }) => {
      const staleOp = options.where.updatedAt;
      const staleBefore = staleOp[Object.getOwnPropertySymbols(staleOp)[0]!] as Date;
      const recentlyUpdated = new Date();
      const startedLongAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const wouldMatch = recentlyUpdated < staleBefore;
      const wouldMatchIfStartedAt = startedLongAgo < staleBefore;
      assert.equal(wouldMatch, false);
      assert.equal(wouldMatchIfStartedAt, true);
      return [0];
    });
    const result = await runStaleProcessingSweep();
    assert.equal(result.failed, 0);
  });
});
