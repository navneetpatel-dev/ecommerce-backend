import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { OrderItem } from '@database/models/orderItem.model';
import { settingsService } from '@modules/settings/settings.service';
import { categoriesService } from '@modules/categories/categories.service';
import { subOrdersInReturnWindow } from '../returnWindowHold';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('subOrdersInReturnWindow', () => {
  afterEach(() => mock.restoreAll());

  it('holds a sale until the longest return window of its items has passed', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({ defaultReturnWindow: 7 }) as never);
    // cat-long allows 30-day returns; cat-default has no window of its own (7 days).
    mock.method(categoriesService, 'walkCategoryAncestors', async (categoryId: string) =>
      (categoryId === 'cat-long' ? [{ returnWindowDays: 30 }] : [{ returnWindowDays: null }]) as never,
    );
    mock.method(OrderItem, 'findAll', async () =>
      [
        { subOrderId: 'so-mixed', variant: { product: { categoryId: 'cat-default' } } },
        { subOrderId: 'so-mixed', variant: { product: { categoryId: 'cat-long' } } },
        { subOrderId: 'so-default', variant: { product: { categoryId: 'cat-default' } } },
      ] as never,
    );

    const now = new Date('2026-09-26T00:00:00Z');
    const deliveredAt = new Date(now.getTime() - 10 * DAY_MS);
    const held = await subOrdersInReturnWindow(
      [
        { id: 'so-mixed', deliveredAt },
        { id: 'so-default', deliveredAt },
      ],
      now,
    );

    // 10 days after delivery: the 30-day item still holds its sale; the 7-day one is clear.
    assert.deepEqual([...held], ['so-mixed']);
  });

  it('holds nothing and queries nothing without delivered sub-orders', async () => {
    const findAll = mock.method(OrderItem, 'findAll', async () => [] as never);
    assert.equal((await subOrdersInReturnWindow([])).size, 0);
    assert.equal(findAll.mock.callCount(), 0);
  });
});
