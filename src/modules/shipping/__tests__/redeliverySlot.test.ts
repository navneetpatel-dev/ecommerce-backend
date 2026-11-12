import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RescheduleDeliverySchema, resolveRedeliverySlot } from '../redeliverySlot';

// 11 Nov 2026, 10:00 in India.
const now = new Date('2026-11-11T04:30:00Z');

describe('rescheduling a failed delivery (B-45)', () => {
  it('stores a real day and window from tomorrow to 14 days ahead', () => {
    assert.equal(resolveRedeliverySlot({ date: '2026-11-12', window: 'MORNING' }, now), '2026-11-12, morning (9am–12pm)');
    assert.equal(resolveRedeliverySlot({ date: '2026-11-25', window: 'EVENING' }, now), '2026-11-25, evening (4pm–8pm)');
  });

  it('refuses today, the past, too far ahead and impossible dates', () => {
    for (const date of ['2026-11-11', '2020-01-01', '2026-11-26', '2026-02-30']) {
      assert.throws(() => resolveRedeliverySlot({ date, window: 'MORNING' }, now), { statusCode: 422 }, date);
    }
  });

  it('refuses free text, and still reads the labels the old picker sent as tomorrow', () => {
    assert.equal(RescheduleDeliverySchema.safeParse({ slot: '2020-01-01 morning' }).success, false);
    const legacy = RescheduleDeliverySchema.parse({ slot: 'Tomorrow afternoon (12pm - 4pm)' });
    assert.equal(resolveRedeliverySlot(legacy, now), '2026-11-12, afternoon (12pm–4pm)');
  });
});
