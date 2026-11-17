import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyMailError, sanitizeMailError } from '../mailErrors';

const err = (fields: Record<string, unknown>) => Object.assign(new Error(String(fields.message ?? 'x')), fields);

describe('classifyMailError', () => {
  it('treats Gmail throttling, timeouts and 4xx replies as temporary (retry)', () => {
    const cases = [
      err({ code: 'EAUTH', responseCode: 454, message: 'Invalid login: 454-4.7.0 Too many login attempts, please try again later' }),
      err({ code: 'ETIMEDOUT', message: 'Connection timeout' }),
      err({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' }),
      err({ responseCode: 421, message: 'Service not available' }),
      err({ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }),
    ];
    for (const e of cases) {
      const info = classifyMailError(e);
      assert.equal(info.category, 'TEMPORARY', String(e.message));
      assert.equal(info.retryable, true);
      assert.equal(info.suppress, false);
    }
  });

  it('treats a refused login as a configuration problem that retrying cannot fix', () => {
    const info = classifyMailError(err({ code: 'EAUTH', responseCode: 535, message: 'Invalid login: 535-5.7.8 Username and Password not accepted' }));
    assert.equal(info.category, 'CONFIG');
    assert.equal(info.retryable, false);
  });

  it('treats a bounced address as a recipient problem: no retry, and the address is suppressed', () => {
    for (const e of [err({ responseCode: 550, response: '550 5.1.1 The email account that you tried to reach does not exist' }), err({ code: 'EENVELOPE', responseCode: 553, message: 'Recipient rejected' })]) {
      const info = classifyMailError(e);
      assert.equal(info.category, 'RECIPIENT');
      assert.equal(info.retryable, false);
      assert.equal(info.suppress, true);
    }
  });

  it('treats other permanent 5xx replies as permanent, and unknown errors as worth a retry', () => {
    const rejected = classifyMailError(err({ responseCode: 554, message: 'Message rejected as spam' }));
    assert.deepEqual([rejected.category, rejected.retryable], ['PERMANENT', false]);
    const unknown = classifyMailError(new Error('something odd'));
    assert.deepEqual([unknown.category, unknown.retryable], ['TEMPORARY', true]);
  });
});

describe('sanitizeMailError', () => {
  it('keeps it to one short line, with no stack or control characters', () => {
    const text = sanitizeMailError(new Error(`line one\nline two\t${'x'.repeat(900)}`));
    assert.doesNotMatch(text, /[\r\n\t]/);
    assert.ok(text.length <= 400);
    assert.equal(sanitizeMailError(undefined), 'Email send failed');
  });
});
