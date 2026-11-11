import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { User } from '@database/models/user.model';
import { CreateAddressSchema } from '../users.dto';
import { recipientFor } from '../addressRecipient';

describe('address recipient (B-37)', () => {
  afterEach(() => mock.restoreAll());

  it('keeps the name and phone the shopper typed', async () => {
    const find = mock.method(User, 'findByPk', async () => null as never);
    assert.deepEqual(await recipientFor('u1', { recipientName: 'Meera Rao', recipientPhone: '9876543210' }), {
      recipientName: 'Meera Rao',
      recipientPhone: '9876543210',
    });
    assert.equal(find.mock.callCount(), 0);
  });

  it('falls back to the account holder when left out', async () => {
    mock.method(User, 'findByPk', async () => ({ name: 'Asha Gupta', phone: '9123456780' }) as never);
    assert.deepEqual(await recipientFor('u1', {}), { recipientName: 'Asha Gupta', recipientPhone: '9123456780' });
  });

  it('validates the recipient phone like any other phone', () => {
    const base = { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
    assert.equal(CreateAddressSchema.safeParse({ ...base, recipientPhone: 'abc' }).success, false);
    assert.equal(CreateAddressSchema.safeParse({ ...base, recipientName: 'Meera', recipientPhone: '+91 98765 43210' }).success, true);
  });
});
