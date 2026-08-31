import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completeExportIfProcessing,
  failExportIfProcessing,
  touchExportHeartbeat,
} from '../exportJobLifecycle';

describe('exportJobLifecycle', () => {
  it('exports lifecycle helpers', () => {
    assert.equal(typeof touchExportHeartbeat, 'function');
    assert.equal(typeof completeExportIfProcessing, 'function');
    assert.equal(typeof failExportIfProcessing, 'function');
  });
});
