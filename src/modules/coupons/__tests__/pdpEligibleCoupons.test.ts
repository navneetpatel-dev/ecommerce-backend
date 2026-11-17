import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { Product } from '@database/models/product.model';
import { Vendor } from '@database/models/vendor.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { taxService } from '@modules/tax/tax.service';
import { couponsService } from '../coupons.service';
import { COUPON_STATUS, PRODUCT_STATUS, VENDOR_STATUS } from '@core/constants/statuses';

describe('couponsService.eligibleCoupons on PDP', () => {
  afterEach(() => mock.restoreAll());

  const mockVendor = {
    id: 'vendor-1',
    status: VENDOR_STATUS.APPROVED,
    kycVerified: true,
    pickupState: 'Maharashtra',
  };

  const mockProduct = {
    id: 'prod-101',
    categoryId: 'cat-1',
    vendorId: 'vendor-1',
    name: 'Wireless Earbuds',
    basePrice: 500,
    status: PRODUCT_STATUS.LIVE,
    vendor: mockVendor,
    variants: [{ id: 'var-1', price: 500, stock: 10, weightGrams: 200 }],
  };

  function setupMocks() {
    mock.method(Product, 'findByPk', async () => mockProduct as never);
    mock.method(Vendor, 'findByPk', async (id: string) => {
      if (id === 'vendor-1') return mockVendor as never;
      return null as never;
    });
    mock.method(Vendor, 'findAll', async () => [mockVendor] as never);
    mock.method(ShippingRate, 'findOne', async () => ({ price: 40 } as never));
    mock.method(taxService, 'getGstRateRule', async () => ({
      gstPercentage: 0,
      gstPriceBand: null,
    }));
    mock.method(taxService, 'resolveEffectiveTaxRule', async () => ({
      gstPercentage: 0,
      gstPriceBand: null,
      hsnCode: '8518',
    } as any));
  }

  it('includes coupons with minOrderValue higher than single piece price for product preview', async () => {
    setupMocks();

    const activeCoupon = {
      id: 'coupon-1',
      code: 'SAVE1000',
      type: 'FLAT',
      value: 200,
      minOrderValue: 1000,
      maxDiscountCap: null,
      priority: 10,
      status: COUPON_STATUS.ACTIVE,
      startDate: new Date(Date.now() - 10000),
      endDate: new Date(Date.now() + 100000),
      applicableScope: { type: 'all', ids: [] },
      excludedItems: {},
      userRestriction: { type: 'all' },
      config: {},
      stackable: false,
    };

    mock.method(Coupon, 'findAll', async () => [activeCoupon] as never);

    const offers = await couponsService.eligibleCoupons(null, { productId: 'prod-101' });

    assert.equal(offers.length, 1);
    assert.equal(offers[0]?.code, 'SAVE1000');
    assert.equal(offers[0]?.minOrderValue, 1000);
    assert.equal(offers[0]?.type, 'FLAT');
  });

  it('reflects vendor-specific coupons correctly', async () => {
    setupMocks();

    const vendorCoupon = {
      id: 'coupon-vendor',
      code: 'VENDOR20',
      type: 'PERCENTAGE',
      value: 20,
      vendorId: 'vendor-1',
      minOrderValue: null,
      maxDiscountCap: 500,
      priority: 5,
      status: COUPON_STATUS.ACTIVE,
      startDate: new Date(Date.now() - 10000),
      endDate: new Date(Date.now() + 100000),
      applicableScope: { type: 'vendor', ids: ['vendor-1'] },
      excludedItems: {},
      userRestriction: { type: 'all' },
      config: {},
      stackable: false,
    };

    const otherVendorCoupon = {
      id: 'coupon-other-vendor',
      code: 'OTHER50',
      type: 'PERCENTAGE',
      value: 50,
      vendorId: 'vendor-999',
      minOrderValue: null,
      maxDiscountCap: null,
      priority: 5,
      status: COUPON_STATUS.ACTIVE,
      startDate: new Date(Date.now() - 10000),
      endDate: new Date(Date.now() + 100000),
      applicableScope: { type: 'vendor', ids: ['vendor-999'] },
      excludedItems: {},
      userRestriction: { type: 'all' },
      config: {},
      stackable: false,
    };

    mock.method(Coupon, 'findAll', async () => [vendorCoupon, otherVendorCoupon] as never);

    const offers = await couponsService.eligibleCoupons(null, { productId: 'prod-101' });

    assert.equal(offers.length, 1);
    assert.equal(offers[0]?.code, 'VENDOR20');
    assert.equal(offers[0]?.discount, 100); // 20% of 500
  });
});
