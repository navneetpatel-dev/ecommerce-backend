import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { settingsService } from '@modules/settings/settings.service';
import { returnableOrderItemIds } from '../orderReturnability';

describe('returnableOrderItemIds', () => {
  afterEach(() => mock.restoreAll());

  it('offers a return only for delivered lines with units left, no return yet, inside the window', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () =>
      ({ defaultReturnWindow: 7 }) as never,
    );
    const deliveredAt = new Date('2026-10-10T00:00:00Z');
    const parts = [
      {
        status: 'DELIVERED',
        shipment: { deliveredAt },
        items: [
          { id: 'fresh', quantity: 1 },
          { id: 'already-asked', quantity: 1 },
          { id: 'fully-returned', quantity: 0 },
        ],
      },
      { status: 'SHIPPED', items: [{ id: 'not-delivered', quantity: 1 }] },
    ];

    const inside = await returnableOrderItemIds(parts, new Set(['already-asked']), new Date('2026-10-12T00:00:00Z'));
    const after = await returnableOrderItemIds(parts, new Set(['already-asked']), new Date('2026-11-30T00:00:00Z'));

    assert.deepEqual([...inside], ['fresh']);
    assert.equal(after.size, 0);
  });
});
