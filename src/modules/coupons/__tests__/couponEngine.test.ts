import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { COUPON_STATUS, COUPON_USER_SEGMENT, VENDOR_STATUS } from '@core/constants/statuses';
import { LOYAL_CUSTOMER_MIN_PAID_ORDERS, validateCoupon } from '../couponEngine';

function freeShippingCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon-1',
    code: 'SHIPFREE',
    type: 'FREE_SHIPPING',
    status: COUPON_STATUS.ACTIVE,
    startDate: new Date(Date.now() - 60_000),
    endDate: new Date(Date.now() + 60_000),
    applicableScope: { type: 'all', ids: [] },
    excludedItems: { productIds: [], categoryIds: [] },
    userRestriction: { type: 'all' },
    config: {},
    value: null,
    maxDiscountCap: null,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    usedCount: 0,
    stackable: false,
    vendorId: null,
    ...overrides,
  } as Coupon;
}

const lines = [
  {
    productId: 'product-1',
    categoryId: 'category-1',
    vendorId: 'vendor-1',
    unitPrice: 100,
    quantity: 1,
  },
  {
    productId: 'product-2',
    categoryId: 'category-2',
    vendorId: 'vendor-2',
    unitPrice: 200,
    quantity: 1,
  },
];

describe('FREE_SHIPPING allocation', () => {
  afterEach(() => mock.restoreAll());

  it('discounts only shipping for vendors with eligible product lines', async () => {
    const result = await validateCoupon({
      coupon: freeShippingCoupon({
        applicableScope: { type: 'product', ids: ['product-1'] },
      }),
      lines,
      shippingTotal: 100,
      shippingByVendor: { 'vendor-1': 40, 'vendor-2': 60 },
    });

    assert.equal(result.valid, true);
    assert.equal(result.discount, 40);
    assert.deepEqual(result.vendorDiscountShares, { 'vendor-1': 40 });
  });

  it('discounts only the owning vendor for a vendor coupon', async () => {
    mock.method(
      Vendor,
      'findByPk',
      async () =>
        ({
          id: 'vendor-1',
          status: VENDOR_STATUS.APPROVED,
        }) as Vendor,
    );
    const result = await validateCoupon({
      coupon: freeShippingCoupon({
        vendorId: 'vendor-1',
        applicableScope: { type: 'vendor', ids: ['vendor-1'] },
      }),
      lines,
      shippingTotal: 100,
      shippingByVendor: { 'vendor-1': 40, 'vendor-2': 60 },
    });

    assert.equal(result.discount, 40);
    assert.deepEqual(result.vendorDiscountShares, { 'vendor-1': 40 });
  });

  it('prorates a platform cap over actual vendor shipping', async () => {
    const result = await validateCoupon({
      coupon: freeShippingCoupon({ maxDiscountCap: 50 }),
      lines,
      shippingTotal: 100,
      shippingByVendor: { 'vendor-1': 40, 'vendor-2': 60 },
    });

    assert.equal(result.discount, 50);
    assert.deepEqual(result.vendorDiscountShares, {
      'vendor-1': 20,
      'vendor-2': 30,
    });
  });
});

describe('LOYAL_CUSTOMER_MIN_PAID_ORDERS segment threshold', () => {
  afterEach(() => mock.restoreAll());

  it('treats a customer as LOYAL at the named paid-order threshold', async () => {
    mock.method(Order, 'count', async () => LOYAL_CUSTOMER_MIN_PAID_ORDERS);
    const result = await validateCoupon({
      coupon: freeShippingCoupon({
        userRestriction: { type: 'segment', value: [COUPON_USER_SEGMENT.LOYAL] },
      }),
      userId: 'user-loyal',
      lines,
      shippingTotal: 100,
      shippingByVendor: { 'vendor-1': 40, 'vendor-2': 60 },
    });
    assert.equal(LOYAL_CUSTOMER_MIN_PAID_ORDERS, 3);
    assert.equal(result.valid, true);
  });

  it('does not treat a customer as LOYAL below the named threshold', async () => {
    mock.method(Order, 'count', async () => LOYAL_CUSTOMER_MIN_PAID_ORDERS - 1);
    const result = await validateCoupon({
      coupon: freeShippingCoupon({
        userRestriction: { type: 'segment', value: [COUPON_USER_SEGMENT.LOYAL] },
      }),
      userId: 'user-returning',
      lines,
      shippingTotal: 100,
      shippingByVendor: { 'vendor-1': 40, 'vendor-2': 60 },
    });
    assert.equal(result.valid, false);
  });
});
