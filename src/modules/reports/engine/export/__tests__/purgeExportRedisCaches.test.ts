import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { purgeExportRedisCaches } from '../purgeExportRedisCaches';

describe('purgeExportRedisCaches', () => {
  it('does not throw when redis is unavailable', async () => {
    await assert.doesNotReject(() => purgeExportRedisCaches('00000000-0000-0000-0000-000000000001'));
  });
});
