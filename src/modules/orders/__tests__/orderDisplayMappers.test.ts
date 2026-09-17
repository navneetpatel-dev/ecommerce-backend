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
