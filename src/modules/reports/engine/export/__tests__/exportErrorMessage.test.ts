import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeExportErrorMessage } from '../exportErrorMessage';

describe('sanitizeExportErrorMessage', () => {
  it('returns safe fallback for SQL errors', () => {
    const msg = sanitizeExportErrorMessage(new Error('SELECT * FROM users WHERE id = 1'));
    assert.match(msg, /Export failed/);
    assert.doesNotMatch(msg, /SELECT/i);
  });

  it('passes through short user-facing messages', () => {
    assert.equal(
      sanitizeExportErrorMessage(new Error('Export exceeds maximum row limit')),
      'Export exceeds maximum row limit',
    );
  });
});
