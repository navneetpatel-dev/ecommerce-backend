import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canMoveCouponStatus } from '../couponStatusRules';
import { couponsReplacedBy, customerCouponName, generateCouponCode } from '../coupon.utils';
import { splitCouponsOntoLines } from '../couponLineShares';
import { assertValidCouponShape } from '../coupons.dto';
import { resolveLineDiscounts } from '@modules/pricing/lineDiscounts';
import { clawbackForReturnPaise } from '@modules/wallet/cashbackBreakdown';
import type { CartLineForCoupon } from '../coupon.utils';

const line = (variantId: string, vendorId: string, rupees: number): CartLineForCoupon => ({
  productId: `p-${variantId}`,
  variantId,
  categoryId: null,
  vendorId,
  unitPrice: rupees,
  quantity: 1,
});

describe('coupon audit regressions', () => {
  it('#2 #46: a vendor cannot reactivate a rejected coupon; nobody revives an archived one', () => {
    assert.equal(canMoveCouponStatus('REJECTED', 'ACTIVE', 'vendor'), false);
    assert.equal(canMoveCouponStatus('PENDING_APPROVAL', 'ACTIVE', 'vendor'), false);
    assert.equal(canMoveCouponStatus('PENDING_APPROVAL', 'ACTIVE', 'admin'), true);
    assert.equal(canMoveCouponStatus('ARCHIVED', 'ACTIVE', 'admin'), false);
    assert.equal(canMoveCouponStatus('PAUSED', 'ACTIVE', 'vendor'), true);
  });

  it('#5: a scoped coupon lands only on its own lines', () => {
    const a = line('a', 'v1', 1000);
    const b = line('b', 'v1', 2000);
    const shares = splitCouponsOntoLines(
      [{ platform: false, vendorBorne: true, freeShipping: false, vendorShares: { v1: 200 }, eligibleLines: [a] }],
      [a, b],
    );
    assert.deepEqual(shares.a, { discountPaise: 20000, vendorBornePaise: 20000 });
    assert.equal(shares.b, undefined);
  });

  it('#5: stacked coupons never push a line below zero', () => {
    const a = line('a', 'v1', 100);
    const b = line('b', 'v1', 1000);
    const shares = splitCouponsOntoLines(
      [
        { platform: false, vendorBorne: true, freeShipping: false, vendorShares: { v1: 80 }, eligibleLines: [a] },
        { platform: true, vendorBorne: false, freeShipping: false, vendorShares: { v1: 50 }, eligibleLines: [a] },
      ],
      [a, b],
    );
    assert.equal(shares.a!.discountPaise, 10000);
    assert.equal(shares.b!.discountPaise, 3000);
    assert.equal(shares.a!.vendorBornePaise, 8000);
  });

  it('#5: the engine keeps a line-targeted discount and still splits untargeted ones', () => {
    const lines = [{ lineSubtotalPaise: 100000 }, { lineSubtotalPaise: 100000 }];
    const targeted = resolveLineDiscounts(
      { lines: [{ discountPaise: 5000, vendorBorneDiscountPaise: 5000 }, {}], merchandiseDiscountPaise: 5000 },
      lines,
      200000,
    );
    assert.deepEqual(targeted.lineDiscounts, [5000, 0]);
    const split = resolveLineDiscounts({ lines: [{}, {}], merchandiseDiscountPaise: 5000 }, lines, 200000);
    assert.deepEqual(split.lineDiscounts, [2500, 2500]);
  });

  it('#8 #39: customer names are in rupees and never the raw code', () => {
    assert.equal(customerCouponName({ code: 'X', type: 'CASHBACK', value: 75 }), '₹75 cashback');
    assert.equal(customerCouponName({ code: 'X', type: 'BUNDLE', value: 40 }), '₹40 off bundle');
    assert.equal(customerCouponName({ code: 'X', type: 'TIERED' }), 'Tiered discount');
  });

  it('#15 #16 #17: a whole coupon is checked, not just the fields sent', () => {
    const base = {
      type: 'PERCENTAGE' as const,
      startDate: new Date(Date.now() - 1000).toISOString(),
      endDate: new Date(Date.now() + 100000).toISOString(),
    };
    assert.throws(() => assertValidCouponShape({ ...base, value: 500 }, { endMustBeFuture: false }));
    assert.throws(() => assertValidCouponShape({ ...base, value: 0 }, { endMustBeFuture: false }));
    assert.throws(() =>
      assertValidCouponShape(
        { ...base, value: 10, userRestriction: { type: 'specific', value: [] } },
        { endMustBeFuture: false },
      ),
    );
    assert.doesNotThrow(() => assertValidCouponShape({ ...base, value: 10 }, { endMustBeFuture: true }));
  });

  it('#23: a non-stackable coupon replaces all; a stackable one only its slot', () => {
    const platform = { code: 'P', stackable: true, vendorId: null };
    const vendor = { code: 'V', stackable: true, vendorId: 'v1' };
    const solo = { code: 'S', stackable: false, vendorId: null };
    assert.deepEqual(couponsReplacedBy(solo, [platform, vendor]).map((c) => c.code), ['P', 'V']);
    assert.deepEqual(couponsReplacedBy({ code: 'Q', stackable: true, vendorId: null }, [platform, vendor]).map((c) => c.code), ['P']);
    assert.deepEqual(couponsReplacedBy(platform, [solo]).map((c) => c.code), ['S']);
  });

  it('#35: a return reverses only its own share of the cashback', () => {
    const entry = {
      couponId: 'c',
      code: 'C',
      vendorId: 'v1',
      bearer: 'VENDOR' as const,
      amountPaise: 10000,
      creditedPaise: 10000,
      lines: [
        { variantId: 'a', vendorId: 'v1', basePaise: 30000, quantity: 3 },
        { variantId: 'b', vendorId: 'v1', basePaise: 70000, quantity: 1 },
      ],
    };
    assert.equal(clawbackForReturnPaise(entry, 'a', 1), 1000);
    assert.equal(clawbackForReturnPaise(entry, 'b', 1), 7000);
    assert.equal(clawbackForReturnPaise(entry, 'other', 1), 0);
    assert.equal(clawbackForReturnPaise({ ...entry, creditedPaise: 500 }, 'b', 1), 500);
  });

  it('#45: bulk codes are long and avoid confusable characters', () => {
    assert.match(generateCouponCode('AU'), /^AU[2-9A-HJKMNP-Z]{10}$/);
  });
});

describe('phase 9 regressions', () => {
  it('9.5: a ₹0 cap is refused', async () => {
    const { CreateCouponSchema } = await import('../coupons.dto');
    const result = CreateCouponSchema.safeParse({
      code: 'CAP0',
      type: 'PERCENTAGE',
      value: 10,
      maxDiscountCap: 0,
      startDate: new Date(Date.now() - 1000).toISOString(),
      endDate: new Date(Date.now() + 100000).toISOString(),
    });
    assert.equal(result.success, false);
  });
});
