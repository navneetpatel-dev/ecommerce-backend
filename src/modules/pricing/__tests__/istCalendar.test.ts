import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { istDateString, istStartOfDay, istStartOfMonth, sqlIstDay } from '../istCalendar';
import { gstPeriodOf } from '../gstPeriod';

// 00:30 IST on 1 Oct 2026 is 19:00 UTC on 30 Sep.
const justAfterIstMidnight = new Date('2026-09-30T19:00:00.000Z');

describe('istCalendar', () => {
  it('dates a moment by the Indian calendar, not the UTC one', () => {
    assert.equal(istDateString(justAfterIstMidnight), '2026-10-01');
    assert.equal(gstPeriodOf(justAfterIstMidnight), '2026-10');
  });

  it('starts the day at midnight IST (18:30 UTC the day before)', () => {
    assert.equal(istStartOfDay(justAfterIstMidnight).toISOString(), '2026-09-30T18:30:00.000Z');
    // 05:00 IST is still the same IST day, although UTC is on the previous date.
    assert.equal(
      istStartOfDay(new Date('2026-10-14T23:30:00.000Z')).toISOString(),
      '2026-10-14T18:30:00.000Z',
    );
  });

  it('starts the month at midnight IST on the 1st, and steps months', () => {
    assert.equal(istStartOfMonth(justAfterIstMidnight).toISOString(), '2026-09-30T18:30:00.000Z');
    assert.equal(istStartOfMonth(justAfterIstMidnight, 1).toISOString(), '2026-10-31T18:30:00.000Z');
    // December rolls into the next year.
    assert.equal(
      istStartOfMonth(new Date('2026-12-15T00:00:00.000Z'), 1).toISOString(),
      '2026-12-31T18:30:00.000Z',
    );
  });

  it('groups a timestamp column by its IST day in SQL', () => {
    assert.equal(sqlIstDay('o."createdAt"'), `date_trunc('day', o."createdAt" AT TIME ZONE 'Asia/Kolkata')`);
  });
});
