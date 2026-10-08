import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RecordWebVitalSchema, WebVitalsSummarySchema } from '../webVitals.dto';

describe('webVitals DTO schemas', () => {
  it('coerces numeric payload values (metrics arrive as string-coerced numbers)', () => {
    const parsed = RecordWebVitalSchema.parse({ name: 'LCP', value: '2500.5' });
    assert.equal(parsed.value, 2500.5);
  });

  it('rejects non-finite values', () => {
    assert.equal(RecordWebVitalSchema.safeParse({ name: 'LCP', value: 'abc' }).success, false);
  });

  it('bounds the metric name length', () => {
    assert.equal(
      RecordWebVitalSchema.safeParse({ name: 'a'.repeat(17), value: 1 }).success,
      false,
    );
  });

  it('is strict: unknown keys are rejected (no metric smuggling)', () => {
    assert.equal(
      RecordWebVitalSchema.safeParse({ name: 'LCP', value: 1, extra: true }).success,
      false,
    );
    assert.equal(
      WebVitalsSummarySchema.safeParse({ from: '2026-01-01', extra: true }).success,
      false,
    );
  });

  it('summary params are all optional and path is length-bounded', () => {
    assert.equal(WebVitalsSummarySchema.safeParse({}).success, true);
    assert.equal(
      WebVitalsSummarySchema.safeParse({ path: 'a'.repeat(513) }).success,
      false,
    );
  });
});
