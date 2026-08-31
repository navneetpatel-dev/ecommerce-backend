import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  invoiceLineTaxBreakdown,
  lineSubtotal,
  lineTotal,
  orderAmountDue,
  orderItemDisplayLineSubtotal,
  productDiscountPercent,
  recomputeOrderDisplayFields,
  recomputeSubOrderDisplayFields,
  scaleTaxBreakdown,
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

  it('recomputes sub-order and order display fields from live components', () => {
    const subDisplay = recomputeSubOrderDisplayFields({
      taxableAmount: 1000,
      taxAmount: 180,
      shippingCost: 50,
      shippingDiscountAmount: 10,
    });
    assert.equal(subDisplay.shippingCharged, 40);
    assert.equal(subDisplay.customerTotal, 1220);

    const orderDisplay = recomputeOrderDisplayFields({
      subOrders: [
        { subtotal: 1000, taxAmount: 180, shippingCost: 50, shippingDiscountAmount: 10 },
      ],
      paymentMethod: 'COD',
      totalAmount: 1220,
      walletAmountUsed: 200,
      razorpayAmountPaid: 0,
    });
    assert.equal(orderDisplay.merchandiseSubtotal, 1000);
    assert.equal(orderDisplay.taxTotal, 180);
    assert.equal(orderDisplay.shippingTotal, 40);
    assert.equal(orderDisplay.amountDue, 1020);
  });

  it('derives amountDue for COD without treating razorpay as fallback', () => {
    assert.equal(orderAmountDue({
      paymentMethod: 'COD',
      totalAmount: 500,
      walletAmountUsed: 0,
      razorpayAmountPaid: 0,
    }), 500);
  });

  it('zeros invoice tax breakdown when line is fully returned', () => {
    assert.deepEqual(invoiceLineTaxBreakdown({
      taxableAmount: 0,
      taxAmount: 0,
      taxBreakdown: { cgst: 0, sgst: 0, igst: 517.16 },
    }), { cgst: 0, sgst: 0, igst: 0 });
  });

  it('derives partial-return line subtotal from stored value', () => {
    assert.equal(orderItemDisplayLineSubtotal({
      unitPrice: 1000,
      quantity: 2,
      taxableAmount: 900,
      taxAmount: 162,
      storedLineSubtotal: 1000,
    }), 1000);
    assert.equal(orderItemDisplayLineSubtotal({
      unitPrice: 1000,
      quantity: 2,
      taxableAmount: 0,
      taxAmount: 0,
    }), 0);
  });

  it('scales tax breakdown for partial returns', () => {
    assert.deepEqual(scaleTaxBreakdown({ cgst: 0, sgst: 0, igst: 100, gstPercentage: 18 }, 0.5), {
      cgst: 0,
      sgst: 0,
      igst: 50,
      gstPercentage: 18,
    });
  });
});
