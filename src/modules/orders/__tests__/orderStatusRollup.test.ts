import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderStatusFromParts } from '../orderStatusRollup';

describe('orderStatusFromParts', () => {
  it('ships the order once every part still going has shipped', () => {
    assert.equal(orderStatusFromParts(['SHIPPED', 'SHIPPED']), 'SHIPPED');
    assert.equal(orderStatusFromParts(['SHIPPED', 'DELIVERED']), 'SHIPPED');
    assert.equal(orderStatusFromParts(['SHIPPED', 'CANCELLED']), 'SHIPPED');
  });

  it('leaves the order alone while a part has not left the seller', () => {
    assert.equal(orderStatusFromParts(['SHIPPED', 'CONFIRMED']), null);
    assert.equal(orderStatusFromParts(['PENDING']), null);
  });

  it('delivers an order with one part delivered and the other cancelled', () => {
    assert.equal(orderStatusFromParts(['DELIVERED', 'CANCELLED']), 'DELIVERED');
    assert.equal(orderStatusFromParts(['DELIVERED', 'RETURNED']), 'DELIVERED');
  });

  it('settles an order nothing was delivered on', () => {
    assert.equal(orderStatusFromParts(['RETURNED', 'RETURNED']), 'RETURNED');
    assert.equal(orderStatusFromParts(['CANCELLED', 'RETURNED']), 'CANCELLED');
    assert.equal(orderStatusFromParts(['CANCELLED']), 'CANCELLED');
  });
});
