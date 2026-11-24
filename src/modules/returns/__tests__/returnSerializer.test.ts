import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeReturn } from '../returnSerializer';
import { RETURN_STATUS, REFUND_STATUS } from '@core/constants/statuses';

describe('serializeReturn', () => {
  it('harmonizes refundStatus to COMPLETED when status is REFUNDED but refundStatus was NONE', () => {
    const raw = {
      id: 'a1b2c3d4-1111-2222-3333-444455556666',
      status: RETURN_STATUS.REFUNDED,
      refundStatus: REFUND_STATUS.NONE,
      subOrder: { orderId: 'b2c3d4e5-9999-8888-7777-666655554444' },
    };
    const serialized = serializeReturn(raw as any, 5);
    assert.equal(serialized.status, RETURN_STATUS.REFUNDED);
    assert.equal(serialized.refundStatus, REFUND_STATUS.COMPLETED);
    assert.equal(serialized.returnReference, '#RET-A1B2C3D4');
    assert.match(serialized.orderReference ?? '', /^#[A-Z0-9]{8}$/);
  });

  it('preserves existing refundStatus for normal lifecycle', () => {
    const raw = {
      id: 'c3d4e5f6-1111-2222-3333-444455556666',
      status: RETURN_STATUS.REQUESTED,
      refundStatus: REFUND_STATUS.NONE,
    };
    const serialized = serializeReturn(raw as any, 5);
    assert.equal(serialized.status, RETURN_STATUS.REQUESTED);
    assert.equal(serialized.refundStatus, REFUND_STATUS.NONE);
    assert.equal(serialized.returnReference, '#RET-C3D4E5F6');
  });
});
