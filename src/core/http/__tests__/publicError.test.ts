import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { ValidationError } from '@core/errors/ValidationError';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import {
  looksLikeInternalErrorMessage,
  publicErrorMessage,
  toPublicErrorBody,
} from '../publicError';

describe('publicErrorMessage', () => {
  it('maps known codes to safe messages', () => {
    assert.equal(
      publicErrorMessage(ERROR_CODES.RATE_LIMITED, 'internal'),
      ERROR_MESSAGES.RATE_LIMITED,
    );
  });

  it('uses validation details for user-facing copy', () => {
    const err = new ValidationError({ email: ['Invalid credentials'] });
    assert.equal(
      publicErrorMessage(err.code, err.message, err.details),
      'Invalid credentials',
    );
  });

  it('strips internal-looking messages', () => {
    assert.equal(
      publicErrorMessage('UNKNOWN', 'at src/modules/foo.ts:10:5'),
      ERROR_MESSAGES.INTERNAL_ERROR,
    );
  });

  it('passes through safe ForbiddenError domain messages', () => {
    assert.equal(
      publicErrorMessage(ERROR_CODES.FORBIDDEN, ERROR_MESSAGES.NOT_YOUR_ORDER),
      ERROR_MESSAGES.NOT_YOUR_ORDER,
    );
  });

  it('discards unsafe ForbiddenError custom text', () => {
    assert.equal(
      publicErrorMessage(ERROR_CODES.FORBIDDEN, 'Missing permission: orders.read'),
      ERROR_MESSAGES.FORBIDDEN,
    );
  });
});

describe('toPublicErrorBody', () => {
  it('returns normalized validation details', () => {
    const err = new ValidationError('Cart is empty');
    const body = toPublicErrorBody(err);
    assert.equal(body.code, ERROR_CODES.VALIDATION_ERROR);
    assert.equal(body.message, 'Cart is empty');
    assert.deepEqual(body.details, {
      formErrors: ['Cart is empty'],
    });
  });

  it('sanitizes internal strings in details', () => {
    const err = new AppError('fail', 500, ERROR_CODES.INTERNAL_ERROR, {
      note: 'See backend/src/README.md',
    });
    const body = toPublicErrorBody(err);
    assert.equal(body.details, undefined);
  });
});

describe('looksLikeInternalErrorMessage', () => {
  it('flags stack paths', () => {
    assert.equal(looksLikeInternalErrorMessage('Error at src/app.ts:1:1'), true);
  });
});
