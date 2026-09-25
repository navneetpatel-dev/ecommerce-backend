import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cashDepositDiscrepancy,
  checkoutAmountDue,
  inventoryValuation,
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

  it('derives checkout amount due before payment capture', () => {
    assert.equal(checkoutAmountDue('2364.16', '500.00'), 1864.16);
    assert.equal(checkoutAmountDue('100.00', '150.00'), 0);
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

describe('inventoryValuation', () => {
  it('values stock at the rounded list price', () => {
    assert.equal(inventoryValuation('19.99', 3), 59.97);
    assert.equal(inventoryValuation(0.1, 3), 0.3);
    assert.equal(inventoryValuation(250, 0), 0);
  });
});

describe('cashDepositDiscrepancy', () => {
  it('reports the declared-minus-expected gap in rupees', () => {
    assert.deepEqual(cashDepositDiscrepancy('950.00', '1000.50'), {
      discrepancyAmount: -50.5,
      hasDiscrepancy: true,
    });
    assert.deepEqual(cashDepositDiscrepancy(1000.75, 1000), {
      discrepancyAmount: 0.75,
      hasDiscrepancy: true,
    });
  });

  it('treats a gap within one paisa as matching', () => {
    assert.equal(cashDepositDiscrepancy(0.3, 0.1 + 0.2).hasDiscrepancy, false);
    assert.equal(cashDepositDiscrepancy(100.01, 100).hasDiscrepancy, false);
    assert.equal(cashDepositDiscrepancy(100.02, 100).hasDiscrepancy, true);
  });
});
