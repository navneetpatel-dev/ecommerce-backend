import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutSellerFigures } from '../sellerFigures';

describe('shopper responses drop the seller figures (B-32)', () => {
  it('removes commission, TCS and payout at every depth and keeps the rest', () => {
    const order = {
      id: 'o1',
      totalAmount: 1180,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      subOrders: [
        {
          id: 's1',
          customerTotal: 1180,
          commissionAmount: 100,
          tcsAmount: 10,
          netPayoutAmount: 890,
          items: [{ id: 'i1', unitPrice: 1000, commissionAmount: 100, tcsAmount: 10, netPayoutAmount: 890 }],
        },
      ],
      returns: [{ id: 'r1', refundAmount: 500, refundCommissionAmount: 50, refundTcsAmount: 5 }],
    };
    const view = withoutSellerFigures(order);
    const text = JSON.stringify(view);
    for (const key of ['commissionAmount', 'tcsAmount', 'netPayoutAmount', 'refundCommissionAmount', 'refundTcsAmount']) {
      assert.ok(!text.includes(`"${key}"`), `${key} leaked`);
    }
    assert.equal(view.subOrders[0].items[0].unitPrice, 1000);
    assert.equal(view.returns[0].refundAmount, 500);
    assert.ok(view.createdAt instanceof Date);
    // The input is not mutated (staff paths may still use it).
    assert.equal(order.subOrders[0].commissionAmount, 100);
  });
});
