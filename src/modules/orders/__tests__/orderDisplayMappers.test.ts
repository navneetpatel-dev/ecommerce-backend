import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasPaiseFields, omitPaiseFields } from '../orderSerialize.utils';
import { mapOrderItem, mapOrderResponse, mapSubOrder } from '../orderDisplayMappers';

describe('omitPaiseFields', () => {
  it('removes keys ending with Paise', () => {
    const result = omitPaiseFields({
      unitPrice: 100,
      unitPricePaise: 10000,
      taxAmountPaise: 1800,
    });
    assert.equal(result.unitPrice, 100);
    assert.equal('unitPricePaise' in result, false);
    assert.equal('taxAmountPaise' in result, false);
  });
});

describe('mapOrderItem', () => {
  it('does not leak paise columns', () => {
    const mapped = mapOrderItem({
      id: 'item-1',
      variantId: 'var-1',
      productName: 'Test',
      quantity: 2,
      unitPrice: 100,
      unitPricePaise: 99900,
      taxableAmount: 180,
      taxAmount: 18,
      discountAmount: 0,
      commissionAmount: 0,
      tcsAmount: 0,
      netPayoutAmount: 0,
      lineSubtotal: 200,
    });
    assert.equal(hasPaiseFields(mapped as Record<string, unknown>), false);
    assert.equal(mapped.unitPrice, 100);
    assert.equal(mapped.quantity, 2);
  });

  it('resolves live product images even when the parent product is soft-deleted', () => {
    const mapped = mapOrderItem({
      id: 'item-1',
      variantId: 'var-1',
      productName: 'Archived shirt',
      quantity: 1,
      unitPrice: 100,
      taxableAmount: 100,
      taxAmount: 0,
      discountAmount: 0,
      commissionAmount: 0,
      tcsAmount: 0,
      netPayoutAmount: 0,
      lineSubtotal: 100,
      variant: {
        attributes: { Size: 'M' },
        product: {
          slug: 'archived-shirt',
          deletedAt: new Date('2026-01-01'),
          images: [
            { url: 'https://cdn.example/archived.jpg', isPrimary: true },
          ],
        },
      },
    });
    assert.equal(mapped.imageUrl, 'https://cdn.example/archived.jpg');
  });
});

describe('mapSubOrder', () => {
  it('does not leak paise columns', () => {
    const mapped = mapSubOrder({
      id: 'sub-1',
      orderId: 'ord-1',
      vendorId: 'ven-1',
      status: 'CONFIRMED',
      subtotal: 200,
      shippingCost: 50,
      shippingCostPaise: 5000,
      shippingDiscountAmount: 0,
      taxAmount: 18,
      taxableAmount: 180,
      discountAmount: 0,
      taxBreakdown: { cgst: 9, sgst: 9, igst: 0 },
      items: [],
    });
    assert.equal(hasPaiseFields(mapped as Record<string, unknown>), false);
    assert.equal(mapped.shippingDisplayKey, 'PAID');
    assert.equal(mapped.taxDisplayKey, 'CGST_SGST');
  });
});

describe('mapOrderResponse', () => {
  it('reports the card money refunded for cancelled parts and whole-order cancels', () => {
    const mapped = mapOrderResponse({
      id: 'order-1',
      totalAmount: 1500,
      cancelRefundStatus: 'NONE',
      cancelRefundAmountPaise: null,
      subOrders: [
        { id: 's1', status: 'CANCELLED', subtotal: 500, customerTotal: 500, cancelRefundAmountPaise: 40_000, cancelRefundStatus: 'INITIATED' },
        { id: 's2', status: 'CANCELLED', subtotal: 300, customerTotal: 300, cancelRefundAmountPaise: 24_000, cancelRefundStatus: 'FAILED' },
        { id: 's3', status: 'CONFIRMED', subtotal: 700, customerTotal: 700 },
      ],
    });
    // The failed ₹240 has not reached the card yet.
    assert.equal(mapped.cancellationRefundAmount, 400);
    assert.equal(mapped.subOrders[1]!.cancelRefundStatus, 'FAILED');
    assert.equal(mapped.subOrders[1]!.cancelRefundAmount, 240);
  });

  it('does not leak paise columns from the order or nested sub-orders', () => {
    const mapped = mapOrderResponse({
      id: 'order-1',
      userId: 'user-1',
      totalAmount: 200,
      totalAmountPaise: 20_000,
      walletAmountUsed: 0,
      discountTotal: 0,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      subOrders: [{
        id: 'sub-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        subtotal: 200,
        subtotalPaise: 20_000,
        shippingCost: 0,
        shippingDiscountAmount: 0,
        taxableAmount: 200,
        taxAmount: 0,
        discountAmount: 0,
        items: [],
      }],
    });

    assert.equal(hasPaiseFields(mapped as Record<string, unknown>), false);
    assert.equal(
      hasPaiseFields(mapped.subOrders[0] as Record<string, unknown>),
      false,
    );
  });

  it('preserves mixed GST semantics from raw sub-order tax breakdowns', () => {
    const mapped = mapOrderResponse({
      id: 'order-mixed-tax',
      userId: 'user-1',
      totalAmount: 236,
      walletAmountUsed: 0,
      discountTotal: 0,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      subOrders: [
        {
          id: 'sub-mixed',
          subtotal: 200,
          shippingCost: 0,
          shippingDiscountAmount: 0,
          taxableAmount: 200,
          taxAmount: 36,
          taxBreakdown: { cgst: 9, sgst: 9, igst: 18 },
          discountAmount: 0,
          items: [],
        },
      ],
    });

    assert.equal(mapped.subOrders[0]?.taxDisplayKey, 'GST');
    assert.equal(mapped.taxDisplayKey, 'GST');
  });
});

describe('order bill as the customer saw it (GST included)', () => {
  const vendor = { id: 'v1', businessName: 'Seller' };

  it('shows each line with GST and what the coupon took off, adding up to the total', () => {
    // Two ₹1,000 (pre-GST) pieces at 18% IGST and a ₹200 coupon (₹169.49 off pre-GST).
    const couponed = {
      id: 'i1',
      quantity: 2,
      unitPrice: 1000,
      lineSubtotal: 2000,
      discountAmount: 169.49,
      taxableAmount: 1830.51,
      taxAmount: 329.49,
      taxBreakdown: { cgst: 0, sgst: 0, igst: 329.49, total: 329.49, gstPercentage: 18 },
    };
    const plain = {
      id: 'i2',
      quantity: 1,
      unitPrice: 99.99,
      lineSubtotal: 99.99,
      discountAmount: 0,
      taxableAmount: 99.99,
      taxAmount: 18,
      taxBreakdown: { cgst: 9, sgst: 9, igst: 0, total: 18, gstPercentage: 18 },
    };
    const item = mapOrderItem(couponed);
    assert.equal(item.displayUnitPrice, 1180);
    assert.equal(item.lineDisplaySubtotal, 2360);
    // No coupon: exactly what was paid for the line.
    assert.equal(mapOrderItem(plain).lineDisplaySubtotal, 117.99);

    const order = mapOrderResponse({
      id: 'o1',
      totalAmount: 2277.99,
      walletAmountUsed: 0,
      paymentMethod: 'COD',
      subOrders: [
        {
          id: 's1',
          vendor,
          status: 'CONFIRMED',
          subtotal: 2099.99,
          shippingCost: 0,
          shippingDiscountAmount: 0,
          discountAmount: 169.49,
          taxableAmount: 1930.5,
          taxAmount: 347.49,
          items: [couponed, plain],
        },
      ],
    });
    assert.equal(order.itemsTotal, 2477.99);
    assert.equal(order.couponSavings, 200);
    // items − coupon savings + shipping = total
    assert.equal(Math.round((order.itemsTotal - order.couponSavings) * 100), Math.round(order.totalAmount * 100));
  });
});
