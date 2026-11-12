import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestEffortCleanup } from '../bestEffortCleanup';

describe('bestEffortCleanup (B-67)', () => {
  it('returns what the clean-up deleted', async () => {
    assert.equal(await bestEffortCleanup('S3 cascade', {}, async () => 3), 3);
  });

  it('swallows a storage failure so the request that deleted the row still succeeds', async () => {
    const failing = async () => {
      throw Object.assign(new Error('The bucket must be addressed using the specified endpoint'), { name: 'PermanentRedirect' });
    };
    assert.equal(await bestEffortCleanup('S3 cascade', { entityId: 'r1' }, failing), 0);
  });
});
