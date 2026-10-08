import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSesEventBody } from '../webhooks.payload';

describe('parseSesEventBody', () => {
  it('parses a raw JSON buffer (express.raw) into an object', () => {
    const payload = { eventType: 'Bounce', mail: { messageId: 'm1' } };
    const parsed = parseSesEventBody(Buffer.from(JSON.stringify(payload)));
    assert.deepEqual(parsed, payload);
  });

  it('passes through an already-parsed object unchanged', () => {
    const payload = { eventType: 'Delivery' };
    assert.equal(parseSesEventBody(payload), payload);
  });

  it('throws on a buffer that is not valid JSON (surfaced by asyncHandler)', () => {
    assert.throws(() => parseSesEventBody(Buffer.from('{not json')), SyntaxError);
  });
});
