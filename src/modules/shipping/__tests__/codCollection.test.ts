import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ORDER_STATUS } from '@core/constants/statuses';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { toPaise } from '@modules/pricing/money';
import { codAmountForSubOrderPaise } from '../codCollection';

type Sub = { id: string; status: string; customerTotal: number };

function mockOrder(subs: Sub[], shipments: Array<{ subOrderId: string; codAmount: number }>) {
  mock.method(SubOrder, 'findAll', async () => subs as never);
  mock.method(Shipment, 'findAll', async (options: { where: { subOrderId: { [k: symbol]: string[] } } }) => {
    const ids = Object.getOwnPropertySymbols(options.where.subOrderId).flatMap(
      (key) => options.where.subOrderId[key]!,
    );
    return shipments.filter((row) => ids.includes(row.subOrderId)) as never;
  });
}

// A ₹1,049 COD order: two ₹500 parts plus the ₹49 gift wrap, ₹300 paid from the wallet.
const order = {
  id: 'order-1',
  paymentMethod: 'COD',
  totalAmount: 1049,
  originalTotalAmount: 1049,
  walletAmountUsed: 300,
  razorpayAmountPaid: 0,
  giftWrapFeeAmount: 49,
};
const parts: Sub[] = [
  { id: 'so-a', status: ORDER_STATUS.CONFIRMED, customerTotal: 500 },
  { id: 'so-b', status: ORDER_STATUS.CONFIRMED, customerTotal: 500 },
];

describe('codAmountForSubOrderPaise', () => {
  afterEach(() => mock.restoreAll());

  it('collects what is owed after the wallet, gift wrap on the first shipment, exact in total', async () => {
    mockOrder(parts, []);
    const first = await codAmountForSubOrderPaise(order, 'so-a');
    mock.restoreAll();
    mockOrder(parts, [{ subOrderId: 'so-a', codAmount: first / 100 }]);
    const last = await codAmountForSubOrderPaise(order, 'so-b');

    // ₹1,049 − ₹300 wallet = ₹749 owed at the door, not ₹1,000.
    assert.equal(first + last, toPaise(749));
    // First shipment: its ₹500 and the ₹49 fee, each less its wallet share.
    const share = (part: number) => Math.round((74900 * part) / 104900);
    assert.equal(first, share(50000) + share(4900));
  });

  it('collects nothing for a wallet-paid order and nothing extra after a cancellation', async () => {
    mockOrder(parts, []);
    assert.equal(await codAmountForSubOrderPaise({ ...order, walletAmountUsed: 1049 }, 'so-a'), 0);

    // so-b was cancelled and its wallet share (≈ ₹143) went back: so-a owes its ₹500 + ₹49
    // less the wallet left on it.
    mock.restoreAll();
    mockOrder([parts[0]!, { ...parts[1]!, status: ORDER_STATUS.CANCELLED }], []);
    const only = await codAmountForSubOrderPaise(order, 'so-a');
    const walletBack = Math.round((50000 * 30000) / 104900);
    assert.equal(only, 54900 - (30000 - walletBack));
  });
});
