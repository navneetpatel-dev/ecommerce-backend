import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUG_REPORT_STATUS, SUPPORT_TICKET_STATUS } from '@core/constants/statuses';
import {
  BUG_ALLOWED_TRANSITIONS,
  canTransitionBugStatus,
} from '@modules/bugReports/bugReports.lifecycle';
import {
  TICKET_ALLOWED_TRANSITIONS,
  canTransitionTicketStatus,
} from '@modules/supportTickets/supportTickets.lifecycle';

describe('bug report lifecycle', () => {
  it('allows NEW → TRIAGED / DUPLICATE only', () => {
    assert.deepEqual(BUG_ALLOWED_TRANSITIONS[BUG_REPORT_STATUS.NEW], [
      BUG_REPORT_STATUS.TRIAGED,
      BUG_REPORT_STATUS.DUPLICATE,
    ]);
  });

  it('keeps WONT_FIX and DUPLICATE terminal', () => {
    assert.deepEqual(BUG_ALLOWED_TRANSITIONS[BUG_REPORT_STATUS.WONT_FIX], []);
    assert.deepEqual(BUG_ALLOWED_TRANSITIONS[BUG_REPORT_STATUS.DUPLICATE], []);
  });

  it('allows FIXED → VERIFIED (admin or reporter verify path)', () => {
    assert.equal(
      canTransitionBugStatus(BUG_REPORT_STATUS.FIXED, BUG_REPORT_STATUS.VERIFIED),
      true,
    );
  });

  it('rejects NEW → CLOSED', () => {
    assert.equal(canTransitionBugStatus(BUG_REPORT_STATUS.NEW, BUG_REPORT_STATUS.CLOSED), false);
  });
});

describe('support ticket lifecycle', () => {
  it('allows OPEN → RESOLVED for staff resolve without prior reply', () => {
    assert.ok(
      TICKET_ALLOWED_TRANSITIONS[SUPPORT_TICKET_STATUS.OPEN]!.includes(
        SUPPORT_TICKET_STATUS.RESOLVED,
      ),
    );
  });

  it('keeps CLOSED terminal', () => {
    assert.deepEqual(TICKET_ALLOWED_TRANSITIONS[SUPPORT_TICKET_STATUS.CLOSED], []);
  });

  it('allows RESOLVED → REOPENED', () => {
    assert.equal(
      canTransitionTicketStatus(SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.REOPENED),
      true,
    );
  });

  it('rejects CLOSED → OPEN', () => {
    assert.equal(
      canTransitionTicketStatus(SUPPORT_TICKET_STATUS.CLOSED, SUPPORT_TICKET_STATUS.OPEN),
      false,
    );
  });
});
