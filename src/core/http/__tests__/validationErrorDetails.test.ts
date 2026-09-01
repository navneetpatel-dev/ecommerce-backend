import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeValidationDetails,
  validationDetailsMessage,
} from '../validationErrorDetails';

describe('normalizeValidationDetails', () => {
  it('wraps string messages as formErrors', () => {
    assert.deepEqual(normalizeValidationDetails('Only paid orders can be cancelled'), {
      fieldErrors: {},
      formErrors: ['Only paid orders can be cancelled'],
    });
  });

  it('wraps flat field maps as fieldErrors', () => {
    assert.deepEqual(normalizeValidationDetails({ email: ['Invalid credentials'] }), {
      fieldErrors: { email: ['Invalid credentials'] },
      formErrors: [],
    });
  });

  it('preserves zod flatten shape', () => {
    assert.deepEqual(
      normalizeValidationDetails({
        formErrors: [],
        fieldErrors: { email: ['Invalid email'] },
      }),
      {
        fieldErrors: { email: ['Invalid email'] },
        formErrors: [],
      },
    );
  });
});

describe('validationDetailsMessage', () => {
  it('prefers formErrors over fieldErrors', () => {
    assert.equal(
      validationDetailsMessage({
        formErrors: ['Cart is empty'],
        fieldErrors: { email: ['Invalid email'] },
      }),
      'Cart is empty',
    );
  });

  it('falls back to first field error', () => {
    assert.equal(
      validationDetailsMessage({
        formErrors: [],
        fieldErrors: { email: ['Invalid credentials'] },
      }),
      'Invalid credentials',
    );
  });
});
