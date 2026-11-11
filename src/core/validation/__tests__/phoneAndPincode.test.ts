import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PINCODE_PATTERN } from '@core/constants/pincode';
import { optionalPhoneSchema } from '../phone';

describe('phone numbers on the server (B-42)', () => {
  it('refuses junk and accepts real numbers in the forms people type', () => {
    for (const bad of ['abc', '12', '+91 12345', 'call me 9876543210']) {
      assert.equal(optionalPhoneSchema.safeParse(bad).success, false, bad);
    }
    for (const good of ['9876543210', '+91 98765 43210', '(022) 2345-6789', '']) {
      assert.equal(optionalPhoneSchema.safeParse(good).success, true, good);
    }
  });
});

describe('PIN codes (B-12)', () => {
  it('accepts real Indian PINs and refuses made-up ones', () => {
    for (const pin of ['400001', '560001', '110001', '781001']) assert.ok(PINCODE_PATTERN.test(pin), pin);
    for (const pin of ['999999', '000000', '012345', '12345', 'abcdef']) assert.ok(!PINCODE_PATTERN.test(pin), pin);
  });
});
