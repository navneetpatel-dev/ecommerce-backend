import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { redisClient, withRedis } from '@config/redis';
import { assertNotDuplicateSubmission } from '../duplicateSubmitGuard';

describe('double submit guard (B-47)', () => {
  it('lets the first request through and refuses an identical one right after', async (t) => {
    if ((await withRedis(() => redisClient.ping())) !== 'PONG') return t.skip('redis unavailable');
    const user = randomUUID();
    const body = { subject: 'Late delivery', description: 'Order is late' };
    await assertNotDuplicateSubmission('ticket', user, body);
    await assert.rejects(assertNotDuplicateSubmission('ticket', user, body), { statusCode: 409 });
    // A different ticket, or another user, is not a duplicate.
    await assertNotDuplicateSubmission('ticket', user, { ...body, subject: 'Wrong item' });
    await assertNotDuplicateSubmission('ticket', randomUUID(), body);
  });
});
