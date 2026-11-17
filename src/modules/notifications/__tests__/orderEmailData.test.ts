import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ordersService } from '@modules/orders/orders.service';
import { orderReference } from '@modules/orders/orderReference';
import { buildOrderEmailData } from '../orderEmailData';

const ORDER = {
  id: 'abcd1234-0000-0000-0000-000000000000',
  itemsTotal: 4488,
  couponSavings: 120,
  shippingTotal: 0,
  walletAmountUsed: 500,
  totalAmount: 3868,
  paymentMethod: 'RAZORPAY',
  paymentStatus: 'PAID',
  shippingAddress: { recipientName: 'Karan', line1: '12 MG Road', line2: null, city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  subOrders: [
    { id: 's1', vendor: { businessName: 'TechWorld' }, items: [{ productName: 'Headphones', quantity: 1, lineDisplaySubtotal: 2189.85, variantAttributes: { Color: 'Black' }, imageUrl: 'https://img/a.jpg' }] },
    { id: 's2', vendor: { businessName: 'BookNook' }, items: [{ productName: 'Story Books', quantity: 2, lineDisplaySubtotal: 2298.15, variantAttributes: {}, imageUrl: null }] },
  ],
};

describe('buildOrderEmailData', () => {
  afterEach(() => mock.restoreAll());

  it('builds the items, price breakdown, payment and address from the same order view the site shows', async () => {
    mock.method(ordersService, 'getOrderById', async () => ORDER as never);

    const data = await buildOrderEmailData(ORDER.id, { withTotals: true, withAddress: true, withPayment: true });

    const items = data.items as Array<Record<string, any>>;
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { name: 'Headphones', meta: 'Black · Sold by TechWorld', quantity: 1, price: '₹2,189.85', imageUrl: 'https://img/a.jpg' });
    const totals = data.totals as Array<Record<string, any>>;
    assert.deepEqual(totals.map((row) => row.label), ['Items (incl. GST)', 'Coupon savings', 'Shipping', 'Paid with wallet', 'Order total']);
    assert.equal(totals.find((row) => row.label === 'Shipping')!.value, 'Free');
    assert.equal(totals.at(-1)!.value, '₹3,868.00');
    const details = data.details as Array<Record<string, any>>;
    assert.equal(details[0]!.value, `#${orderReference(ORDER.id)}`);
    assert.match(String(details.find((row) => row.label === 'Ship to')!.value), /Karan\n12 MG Road\nBengaluru, Karnataka 560001/);
    assert.equal(details.find((row) => row.label === 'Payment')!.value, 'Paid online');
  });

  it('limits the items to one part of the order', async () => {
    mock.method(ordersService, 'getOrderById', async () => ORDER as never);
    const data = await buildOrderEmailData(ORDER.id, { subOrderId: 's2' });
    assert.deepEqual((data.items as Array<Record<string, any>>).map((item) => item.name), ['Story Books']);
    assert.equal(data.totals, undefined);
  });

  it('degrades to nothing (the email still goes out) when the order cannot be loaded', async () => {
    mock.method(ordersService, 'getOrderById', async () => { throw new Error('gone'); });
    assert.deepEqual(await buildOrderEmailData('x'), {});
  });
});
