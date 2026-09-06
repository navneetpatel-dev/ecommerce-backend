import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductAffinity } from '@database/models/productAffinity.model';
import { runProductAffinityJob } from '@jobs/productAffinity.processor';

function fakeOrderItem(orderId: string, productId: string) {
  return { subOrder: { order: { id: orderId } }, variant: { productId } };
}

describe('runProductAffinityJob', () => {
  afterEach(() => mock.restoreAll());

  it('counts cross-vendor pairs within the same Order, not just the same SubOrder', async () => {
    // Order A: products P1 + P2 bought together (as if from two different vendors' SubOrders).
    // Order B: P1 + P2 again. Order C: P1 alone (no pair).
    mock.method(OrderItem, 'findAll', async () => [
      fakeOrderItem('orderA', 'P1'),
      fakeOrderItem('orderA', 'P2'),
      fakeOrderItem('orderB', 'P1'),
      fakeOrderItem('orderB', 'P2'),
      fakeOrderItem('orderC', 'P1'),
    ]);

    const upserts: Array<Record<string, unknown>> = [];
    mock.method(ProductAffinity, 'upsert', async (data: Record<string, unknown>) => {
      upserts.push(data);
      return [data as never, true];
    });
    mock.method(ProductAffinity, 'destroy', async () => 0);

    const result = await runProductAffinityJob();

    assert.equal(result.pairsUpserted, 2); // P1->P2 and P2->P1
    const p1ToP2 = upserts.find((u) => u.productId === 'P1' && u.relatedProductId === 'P2');
    assert.ok(p1ToP2);
    assert.equal(p1ToP2!.coOccurrenceCount, 2);
    // P1 appears in 3 orders total (A, B, C), and co-occurs with P2 in 2 of them.
    assert.equal(p1ToP2!.score, 2 / 3);

    const p2ToP1 = upserts.find((u) => u.productId === 'P2' && u.relatedProductId === 'P1');
    assert.ok(p2ToP1);
    // P2 appears in 2 orders total, both of which co-occur with P1.
    assert.equal(p2ToP1!.score, 1);
  });

  it('returns zero when there are no multi-product orders in the lookback window', async () => {
    mock.method(OrderItem, 'findAll', async () => [fakeOrderItem('orderA', 'P1')]);
    mock.method(ProductAffinity, 'destroy', async () => 0);

    const result = await runProductAffinityJob();

    assert.equal(result.pairsUpserted, 0);
    assert.equal(result.productsUpdated, 0);
  });
});
