import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, it, mock } from 'node:test';
import { redisClient, withRedis } from '@config/redis';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { notificationsService } from '@modules/notifications/notifications.service';
import { processLowStock } from '../lowStockDigest';

describe('low-stock emails (B-53)', () => {
  afterEach(() => mock.restoreAll());

  it('sends one digest per seller, and not again until restocked', async (t) => {
    if ((await withRedis(() => redisClient.ping())) !== 'PONG') return t.skip('redis unavailable');
    const vendorId = randomUUID();
    const variants = Array.from({ length: 15 }, (_, i) => ({
      id: randomUUID(),
      sku: `SKU-${i}`,
      stock: i % 3,
      product: { name: `Women Clothing Classic ${i}`, vendorId },
    }));
    let restocked: string[] = [];
    mock.method(ProductVariant, 'findAll', async (opts: { attributes?: string[] }) =>
      (opts.attributes ? variants.filter((v) => restocked.includes(v.id)) : variants.filter((v) => !restocked.includes(v.id))) as never);
    mock.method(User, 'findOne', async () => ({ id: 'owner-1' }) as never);
    const send = mock.method(notificationsService, 'sendLowStockAlert', async () => ({ id: 'log' }) as never);
    try {
      assert.equal(await processLowStock(), 1);
      assert.equal(send.mock.callCount(), 1);
      const data = send.mock.calls[0]!.arguments[2] as { productName: string; stockList: string };
      assert.match(data.productName, /and 14 more/);
      assert.match(data.stockList, /and 5 more$/);

      assert.equal(await processLowStock(), 0, 'the next run sends nothing for the same items');

      restocked = [variants[0]!.id];
      await processLowStock(); // clears the restocked one
      restocked = [];
      assert.equal(await processLowStock(), 1, 'it goes low again, so it alerts again');
    } finally {
      await withRedis(() => redisClient.srem('low-stock:alerted', ...variants.map((v) => v.id)));
    }
  });
});
