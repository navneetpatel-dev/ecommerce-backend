import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lastPayoutBoundary, nextPayoutBoundary, normalizePayoutCycle, payoutDeliveryCutoff } from '../payoutCycle';

// Wednesday 2026-11-18 10:30 UTC.
const WED = new Date(Date.UTC(2026, 10, 18, 10, 30));
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe('payout cycle boundaries', () => {
  it('DAILY starts today (UTC)', () => {
    assert.equal(iso(lastPayoutBoundary('DAILY', WED)), '2026-11-18');
    assert.equal(iso(nextPayoutBoundary('DAILY', WED)), '2026-11-19');
  });

  it('WEEKLY starts on the most recent Monday', () => {
    assert.equal(iso(lastPayoutBoundary('WEEKLY', WED)), '2026-11-16');
    assert.equal(iso(nextPayoutBoundary('WEEKLY', WED)), '2026-11-23');
  });

  it('WEEKLY on a Monday itself is that day, on a Sunday is the Monday before', () => {
    assert.equal(iso(lastPayoutBoundary('WEEKLY', new Date(Date.UTC(2026, 10, 16, 0, 0)))), '2026-11-16');
    assert.equal(iso(lastPayoutBoundary('WEEKLY', new Date(Date.UTC(2026, 10, 22, 23, 59)))), '2026-11-16');
  });

  it('BIWEEKLY is always a Monday and 14 days wide', () => {
    const last = lastPayoutBoundary('BIWEEKLY', WED);
    const next = nextPayoutBoundary('BIWEEKLY', WED);
    assert.equal(last.getUTCDay(), 1);
    assert.equal(next.getTime() - last.getTime(), 14 * 24 * 60 * 60 * 1000);
    assert.ok(last <= WED && WED < next);
  });

  it('MONTHLY starts on the 1st', () => {
    assert.equal(iso(lastPayoutBoundary('MONTHLY', WED)), '2026-11-01');
    assert.equal(iso(nextPayoutBoundary('MONTHLY', WED)), '2026-12-01');
    assert.equal(iso(nextPayoutBoundary('MONTHLY', new Date(Date.UTC(2026, 11, 20)))), '2027-01-01');
  });
});

describe('normalizePayoutCycle', () => {
  it('accepts any case and falls back to WEEKLY', () => {
    assert.equal(normalizePayoutCycle('monthly'), 'MONTHLY');
    assert.equal(normalizePayoutCycle(' Daily '), 'DAILY');
    assert.equal(normalizePayoutCycle('fortnightly'), 'WEEKLY');
    assert.equal(normalizePayoutCycle(undefined), 'WEEKLY');
  });
});

describe('payoutDeliveryCutoff', () => {
  it('uses the platform cycle when the vendor has no preference', () => {
    assert.equal(iso(payoutDeliveryCutoff('WEEKLY', null, WED)), '2026-11-16');
  });

  it('lets a vendor be paid less often than the platform', () => {
    assert.equal(iso(payoutDeliveryCutoff('WEEKLY', 'MONTHLY', WED)), '2026-11-01');
  });

  it('never lets a vendor be paid more often than the platform', () => {
    assert.equal(iso(payoutDeliveryCutoff('MONTHLY', 'WEEKLY', WED)), '2026-11-01');
  });
});
