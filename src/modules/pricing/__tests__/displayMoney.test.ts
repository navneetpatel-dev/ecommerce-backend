import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  lineSubtotal,
  lineTotal,
  orderAmountDue,
  productDiscountPercent,
  shippingCharged,
  subOrderCustomerTotal,
} from '../displayMoney';

describe('displayMoney', () => {
  it('derives display totals from stored order components', () => {
    assert.equal(lineSubtotal('1847.00', 1), 1847);
    assert.equal(lineTotal('1847.00', '517.16'), 2364.16);
    assert.equal(shippingCharged('120.00', '20.00'), 100);
    assert.equal(subOrderCustomerTotal({
      taxableAmount: 1847,
      taxAmount: 517.16,
      shippingCost: 120,
      shippingDiscountAmount: 20,
    }), 2464.16);
    assert.equal(orderAmountDue({
      paymentMethod: 'RAZORPAY',
      totalAmount: '2364.16',
      walletAmountUsed: '0.00',
      razorpayAmountPaid: '2364.16',
    }), 2364.16);
  });

  it('computes product marketing display fields', () => {
    assert.equal(productDiscountPercent(999, 1299), 23);
    assert.equal(productDiscountPercent(999, 899), null);
  });
});
