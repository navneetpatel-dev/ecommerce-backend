import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { Vendor } from '@database/models/vendor.model';
import { COUPON_STATUS, DISCOUNT_BEARER, VENDOR_STATUS } from '@core/constants/statuses';
import { validateCouponSet } from '../couponEngine';
import { capStackedCouponShares } from '../coupon.utils';

function coupon(overrides: Partial<Coupon>): Coupon {
  return {
    id: `coupon-${overrides.code}`,
    type: 'FLAT',
    status: COUPON_STATUS.ACTIVE,
    startDate: new Date(Date.now() - 60_000),
    endDate: new Date(Date.now() + 60_000),
    applicableScope: { type: 'all', ids: [] },
    excludedItems: { productIds: [], categoryIds: [] },
    userRestriction: { type: 'all' },
    config: {},
    value: 0,
    maxDiscountCap: null,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    usedCount: 0,
    stackable: true,
    vendorId: null,
    discountBearer: DISCOUNT_BEARER.PLATFORM,
    ...overrides,
  } as Coupon;
}

describe('capStackedCouponShares', () => {
  it("applies the vendor's coupon first and gives the platform coupon what is left", () => {
    const capped = capStackedCouponShares(
      [
        { platform: true, freeShipping: false, shares: { 'vendor-1': 120 } },
        { platform: false, freeShipping: false, shares: { 'vendor-1': 500 } },
      ],
      { 'vendor-1': 600 },
    );
    assert.deepEqual(capped, [{ 'vendor-1': 100 }, { 'vendor-1': 500 }]);
  });

  it('leaves coupons that fit untouched, and caps shipping at the shipping charged', () => {
    const capped = capStackedCouponShares(
      [
        { platform: true, freeShipping: false, shares: { 'vendor-1': 50 } },
        { platform: true, freeShipping: true, shares: { 'vendor-1': 40 } },
        { platform: false, freeShipping: true, shares: { 'vendor-1': 40 } },
      ],
      { 'vendor-1': 600 },
      { 'vendor-1': 40 },
    );
    assert.deepEqual(capped, [{ 'vendor-1': 50 }, { 'vendor-1': 0 }, { 'vendor-1': 40 }]);
  });
});

describe('validateCouponSet with stacked coupons', () => {
  afterEach(() => mock.restoreAll());

  it('records only the discount actually given when stacked coupons exceed the price', async () => {
    const rows = [
      coupon({ code: 'PLAT20', type: 'PERCENTAGE', value: 20 }),
      coupon({
        code: 'SHOP500',
        value: 500,
        vendorId: 'vendor-1',
        discountBearer: DISCOUNT_BEARER.VENDOR,
      }),
    ];
    mock.method(Coupon, 'findOne', async (options: { where: { code?: string } }) =>
      rows.find((row) => row.code === options.where.code) ?? null,
    );
    mock.method(Coupon, 'findAll', async () => rows);
    mock.method(Vendor, 'findByPk', async () => ({ id: 'vendor-1', status: VENDOR_STATUS.APPROVED, kycVerified: true }) as Vendor);

    const result = await validateCouponSet({
      codes: ['PLAT20', 'SHOP500'],
      userId: 'user-1',
      lines: [{ productId: 'p-1', categoryId: 'c-1', vendorId: 'vendor-1', unitPrice: 600, quantity: 1 }],
    });

    assert.equal(result.valid, true);
    // ₹600 item: the vendor's ₹500 first, the platform's 20% (₹120) cut to the ₹100 left.
    assert.equal(result.discount, 600);
    assert.deepEqual(
      result.perCoupon.map((row) => [row.code, row.discount]),
      [
        ['PLAT20', 100],
        ['SHOP500', 500],
      ],
    );
    assert.deepEqual(result.vendorDiscountShares, { 'vendor-1': 600 });
    assert.deepEqual(result.vendorBorneDiscountShares, { 'vendor-1': 500 });
  });
});
