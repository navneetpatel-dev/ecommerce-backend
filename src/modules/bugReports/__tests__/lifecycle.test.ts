import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUG_ALLOWED_TRANSITIONS,
  canTransitionBugStatus,
} from '../bugReports.lifecycle';
import { BUG_REPORT_STATUS } from '@core/constants/statuses';

describe('bugReports.lifecycle (module-local)', () => {
  it('exports the same transition map used by the service', () => {
    assert.ok(Object.keys(BUG_ALLOWED_TRANSITIONS).length >= 8);
    assert.equal(
      canTransitionBugStatus(BUG_REPORT_STATUS.VERIFIED, BUG_REPORT_STATUS.CLOSED),
      true,
    );
  });
});
