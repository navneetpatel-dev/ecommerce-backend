import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { screenContent } from '../contentFilter';

describe('screenContent', () => {
  it('passes completely clean feedback and questions', () => {
    const result1 = screenContent('Excellent build quality and very comfortable to wear.');
    assert.equal(result1.isClean, true);
    assert.deepEqual(result1.flags, []);

    const result2 = screenContent('Does this product come with a 1-year manufacturer warranty?');
    assert.equal(result2.isClean, true);
    assert.deepEqual(result2.flags, []);

    const result3 = screenContent('');
    assert.equal(result3.isClean, true);

    const result4 = screenContent(null);
    assert.equal(result4.isClean, true);
  });

  it('detects phone numbers in various formats', () => {
    // 10-digit mobile
    const res1 = screenContent('Great product, call 9876543210 for details');
    assert.equal(res1.isClean, false);
    assert.ok(res1.flags.includes('PII_PHONE'));

    // +91 format
    const res2 = screenContent('Reach me at +91-98765-43210');
    assert.equal(res2.isClean, false);
    assert.ok(res2.flags.includes('PII_PHONE'));

    // Spaced out
    const res3 = screenContent('Call 98765 43210 quickly');
    assert.equal(res3.isClean, false);
    assert.ok(res3.flags.includes('PII_PHONE'));
  });

  it('detects email addresses', () => {
    const res1 = screenContent('Contact me at john.doe@example.com for discount');
    assert.equal(res1.isClean, false);
    assert.ok(res1.flags.includes('PII_EMAIL'));

    const res2 = screenContent('Email me at user [at] test [dot] com');
    assert.equal(res2.isClean, false);
    assert.ok(res2.flags.includes('PII_EMAIL'));
  });

  it('detects external URLs and websites', () => {
    const res1 = screenContent('Cheaper on https://deals.example.com/item');
    assert.equal(res1.isClean, false);
    assert.ok(res1.flags.includes('EXTERNAL_LINK'));

    const res2 = screenContent('Visit www.mygreatstore.in for better prices');
    assert.equal(res2.isClean, false);
    assert.ok(res2.flags.includes('EXTERNAL_LINK'));

    const res3 = screenContent('Check out bestdeals.store now');
    assert.equal(res3.isClean, false);
    assert.ok(res3.flags.includes('EXTERNAL_LINK'));
  });

  it('detects off-platform communication and payment solicitations', () => {
    const res1 = screenContent('Message me on WhatsApp for more colors');
    assert.equal(res1.isClean, false);
    assert.ok(res1.flags.includes('OFF_PLATFORM_SOLICITATION'));

    const res2 = screenContent('Pay via GPay outside the app for 10% cash discount');
    assert.equal(res2.isClean, false);
    assert.ok(res2.flags.includes('OFF_PLATFORM_SOLICITATION'));
  });

  it('detects abusive language and profanities including masked/leetspeak words', () => {
    const res1 = screenContent('This seller is a fucking fraud');
    assert.equal(res1.isClean, false);
    assert.ok(res1.flags.includes('PROFANITY'));

    // Obfuscated / masked
    const res2 = screenContent('Total f*ck waste of money');
    assert.equal(res2.isClean, false);
    assert.ok(res2.flags.includes('PROFANITY'));

    const res3 = screenContent('What an absolute bastard');
    assert.equal(res3.isClean, false);
    assert.ok(res3.flags.includes('PROFANITY'));
  });

  it('does not falsely flag benign words containing sub-sequences', () => {
    // "classic", "assessment", "glass", "button", "document"
    const res1 = screenContent('A classic watch with premium glass finish.');
    assert.equal(res1.isClean, true);

    const res2 = screenContent('Initial assessment is that buttons are sturdy.');
    assert.equal(res2.isClean, true);
  });
});
