import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { returnsService } from '../returns.service';
import { cancelReturnByCustomer } from '../returnCustomerActions';

function stub(row: Record<string, unknown> | null) {
  mock.method(ReturnRequest, 'findByPk', async () => row as never);
  return mock.method(returnsService, 'delete', async () => undefined);
}

describe('shopper cancels a return (B-50)', () => {
  afterEach(() => mock.restoreAll());

  it('withdraws their own request while nobody has acted on it', async () => {
    const remove = stub({ id: 'r1', userId: 'u1', status: 'REQUESTED' });
    assert.deepEqual(await cancelReturnByCustomer('r1', 'u1'), { cancelled: true });
    assert.equal(remove.mock.callCount(), 1);
  });

  it('refuses someone else’s return and one already reviewed', async () => {
    stub({ id: 'r1', userId: 'u2', status: 'REQUESTED' });
    await assert.rejects(cancelReturnByCustomer('r1', 'u1'), { statusCode: 403 });
    mock.restoreAll();
    const remove = stub({ id: 'r1', userId: 'u1', status: 'APPROVED' });
    await assert.rejects(cancelReturnByCustomer('r1', 'u1'), { statusCode: 422 });
    assert.equal(remove.mock.callCount(), 0);
  });
});
