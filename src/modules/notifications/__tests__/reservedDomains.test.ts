import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isReservedTestDomain } from '../reservedDomains';

describe('isReservedTestDomain', () => {
  it('flags documentation and test domains, which can never receive mail', () => {
    for (const email of ['a@example.com', 'A@EXAMPLE.ORG', 'b@mail.example.net', 'c@shop.test', 'd@x.invalid', 'e@localhost', 'f@team.local']) {
      assert.equal(isReservedTestDomain(email), true, email);
    }
  });

  it('lets real domains through, including look-alikes', () => {
    for (const email of ['a@gmail.com', 'b@myexample.com', 'c@example.com.au', 'd@testing.io', 'e@shop.co.in']) {
      assert.equal(isReservedTestDomain(email), false, email);
    }
  });
});
