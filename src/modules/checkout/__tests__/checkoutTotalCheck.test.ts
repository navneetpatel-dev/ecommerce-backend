import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertExpectedGrandTotal, CHECKOUT_TOTAL_CHANGED } from '../checkoutTotalCheck';

describe('assertExpectedGrandTotal', () => {
  it('lets the order through at the total the customer saw, to the paisa', () => {
    assert.doesNotThrow(() => assertExpectedGrandTotal(1234.5, 1234.5));
    assert.doesNotThrow(() => assertExpectedGrandTotal(undefined, 999));
  });

  it('refuses a changed total and sends the new one back', () => {
    assert.throws(
      () => assertExpectedGrandTotal(1234.5, 1284.5),
      (err: { code?: string; statusCode?: number; details?: { grandTotal?: number } }) =>
        err.code === CHECKOUT_TOTAL_CHANGED && err.statusCode === 409 && err.details?.grandTotal === 1284.5,
    );
  });
});
