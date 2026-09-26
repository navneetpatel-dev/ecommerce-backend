import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { SubOrder } from '@database/models/subOrder.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { returnsService } from '@modules/returns/returns.service';

type Split = { walletRefund: number; razorpayRefund: number };
const split = (order: unknown, refund: number) =>
  (returnsService as unknown as {
    splitRefundAmounts: (o: unknown, r: number, t: unknown) => Promise<Split>;
  }).splitRefundAmounts(order, refund, {});

describe('return refund caps', () => {
  afterEach(() => mock.restoreAll());

  // ₹1500 order: ₹300 wallet + ₹1200 card. Part A (₹500) was cancelled: ₹100 went back
  // to the wallet and ₹400 to the card. Part B (₹1000) is being returned in full.
  const order = {
    id: 'o1',
    paymentMethod: 'RAZORPAY',
    razorpayPaymentId: 'pay_1',
    walletAmountUsed: 300,
    razorpayAmountPaid: 1200,
    originalTotalAmount: 1500,
    totalAmount: 1500,
  };

  it('leaves room for the full return after a cancelled part was refunded', async () => {
    mock.method(SubOrder, 'findAll', async () => [
      { id: 'a', status: 'CANCELLED', customerTotal: 500, cancelRefundAmountPaise: 40_000 },
      { id: 'b', status: 'DELIVERED', customerTotal: 1000 },
    ] as never);
    mock.method(ReturnRequest, 'findAll', async () => []);
    const result = await split(order, 1000);
    assert.equal(result.walletRefund, 200);
    assert.equal(result.razorpayRefund, 800);
  });

  it('never sends more to the card than it still holds after part refunds', async () => {
    // Part A's card refund took more than its share (it was the order's last part once).
    mock.method(SubOrder, 'findAll', async () => [
      { id: 'a', status: 'CANCELLED', customerTotal: 500, cancelRefundAmountPaise: 60_000 },
      { id: 'b', status: 'DELIVERED', customerTotal: 1000 },
    ] as never);
    mock.method(ReturnRequest, 'findAll', async () => []);
    const result = await split(order, 1000);
    assert.equal(result.razorpayRefund, 600);
    assert.equal(result.walletRefund, 200);
  });
});
