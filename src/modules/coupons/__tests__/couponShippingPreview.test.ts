import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Op } from 'sequelize';
import { Address } from '@database/models/address.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { ShippingZone } from '@database/models/shippingZone.model';
import { resolveCartShippingPreviewForCoupon } from '@modules/cart/cartShippingPreview';

describe('coupon shipping preview', () => {
  afterEach(() => mock.restoreAll());

  it('uses the cart vendor weight and delivery zone rate', async () => {
    mock.method(
      Address,
      'findOne',
      async () =>
        ({
          pincode: '400001',
          state: 'Maharashtra',
        }) as Address,
    );
    mock.method(ShippingZone, 'findAll', async () => [
      {
        id: 'zone-1',
        pincodePrefixes: ['400'],
        states: [],
      } as ShippingZone,
    ]);

    let queriedWeight: number | undefined;
    mock.method(ShippingRate, 'findAll', async (options) => {
      const where = options?.where as
        | {
            maxWeightGrams?: { [Op.gte]?: number };
          }
        | undefined;
      queriedWeight = where?.maxWeightGrams?.[Op.gte];
      return [
        {
          zoneId: 'zone-1',
          vendorId: 'vendor-1',
          method: 'STANDARD',
          price: 45,
          estimatedDays: 4,
          freeShippingThreshold: null,
        } as ShippingRate,
      ];
    });

    const shipping = await resolveCartShippingPreviewForCoupon('user-1', [
      {
        productId: 'product-1',
        variantId: 'variant-1',
        categoryId: null,
        vendorId: 'vendor-1',
        unitPrice: 100,
        quantity: 2,
        weightGrams: 300,
        isCustomerVisible: true,
      },
    ]);

    assert.equal(queriedWeight, 600);
    assert.equal(shipping.total, 45);
    assert.deepEqual(shipping.byVendor, { 'vendor-1': 45 });
  });

  it('keeps distinct weights for variants of the same product', async () => {
    mock.method(
      Address,
      'findOne',
      async () =>
        ({
          pincode: '400001',
          state: 'Maharashtra',
        }) as Address,
    );
    mock.method(ShippingZone, 'findAll', async () => [
      {
        id: 'zone-1',
        pincodePrefixes: ['400'],
        states: [],
      } as ShippingZone,
    ]);

    let queriedWeight: number | undefined;
    mock.method(ShippingRate, 'findAll', async (options) => {
      const where = options?.where as
        | {
            maxWeightGrams?: { [Op.gte]?: number };
          }
        | undefined;
      queriedWeight = where?.maxWeightGrams?.[Op.gte];
      return [
        {
          zoneId: 'zone-1',
          vendorId: 'vendor-1',
          method: 'STANDARD',
          price: 60,
          estimatedDays: 4,
          freeShippingThreshold: null,
        } as ShippingRate,
      ];
    });

    await resolveCartShippingPreviewForCoupon('user-1', [
      {
        productId: 'product-1',
        variantId: 'variant-light',
        categoryId: null,
        vendorId: 'vendor-1',
        unitPrice: 100,
        quantity: 2,
        weightGrams: 200,
      },
      {
        productId: 'product-1',
        variantId: 'variant-heavy',
        categoryId: null,
        vendorId: 'vendor-1',
        unitPrice: 150,
        quantity: 1,
        weightGrams: 900,
      },
    ]);

    assert.equal(queriedWeight, 1_300);
  });

  it('returns zero per vendor without a saved destination', async () => {
    mock.method(Address, 'findOne', async () => null);
    const findRates = mock.method(ShippingRate, 'findAll');

    const shipping = await resolveCartShippingPreviewForCoupon('user-1', [
      {
        productId: 'product-1',
        categoryId: null,
        vendorId: 'vendor-1',
        unitPrice: 100,
        quantity: 1,
        weightGrams: 200,
      },
      {
        productId: 'product-2',
        categoryId: null,
        vendorId: 'vendor-2',
        unitPrice: 100,
        quantity: 1,
        weightGrams: 300,
      },
    ]);

    assert.equal(findRates.mock.callCount(), 0);
    assert.equal(shipping.total, 0);
    assert.deepEqual(shipping.byVendor, { 'vendor-1': 0, 'vendor-2': 0 });
  });
});
