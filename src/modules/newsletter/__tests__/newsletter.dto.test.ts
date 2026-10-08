import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SubscribeNewsletterSchema } from '../newsletter.dto';

describe('newsletter DTO schemas', () => {
  it('trims the email but preserves its case', () => {
    const parsed = SubscribeNewsletterSchema.parse({ email: '  Reader@Mail.IO ' });
    assert.equal(parsed.email, 'Reader@Mail.IO');
  });

  it('rejects invalid and overlong emails', () => {
    assert.equal(SubscribeNewsletterSchema.safeParse({ email: 'nope' }).success, false);
    assert.equal(
      SubscribeNewsletterSchema.safeParse({ email: `${'a'.repeat(260)}@b.co` }).success,
      false,
    );
  });

  it('is strict: unknown keys are rejected', () => {
    assert.equal(
      SubscribeNewsletterSchema.safeParse({ email: 'a@b.co', role: 'ADMIN' }).success,
      false,
    );
  });
});
