import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { judgeEmailHealth } from '../emailHealth.service';

const base = { configured: true, queuesReady: true, sent: 20, failed: 0, stuck: 0, lastFailureCategory: null };

describe('judgeEmailHealth', () => {
  it('is healthy when mail is flowing', () => {
    assert.equal(judgeEmailHealth(base).status, 'OK');
    assert.equal(judgeEmailHealth({ ...base, sent: 0, failed: 0 }).status, 'OK', 'a quiet store is not an outage');
  });

  it('is down when no provider is configured or the queue is gone', () => {
    assert.equal(judgeEmailHealth({ ...base, configured: false }).status, 'DOWN');
    assert.match(judgeEmailHealth({ ...base, queuesReady: false }).headline, /queue/i);
  });

  it('is down when emails fail and none gets through, and names a refused login', () => {
    const down = judgeEmailHealth({ ...base, sent: 0, failed: 6, lastFailureCategory: 'CONFIG' });
    assert.equal(down.status, 'DOWN');
    assert.match(down.headline, /password/i);
    assert.equal(judgeEmailHealth({ ...base, sent: 0, failed: 2 }).status, 'OK', 'two failures is not yet an outage');
  });

  it('is degraded when a large share fails or many are stuck', () => {
    assert.equal(judgeEmailHealth({ ...base, sent: 6, failed: 4 }).status, 'DEGRADED');
    assert.equal(judgeEmailHealth({ ...base, stuck: 12 }).status, 'DEGRADED');
    assert.equal(judgeEmailHealth({ ...base, sent: 40, failed: 2 }).status, 'OK');
  });
});
