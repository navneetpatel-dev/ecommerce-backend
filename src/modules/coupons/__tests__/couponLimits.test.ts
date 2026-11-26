import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { Coupon } from '@database/models/coupon.model';
import { clearPermissionCache, setPermissionCache } from '@middleware/rbac.middleware';
import { ROLE_PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { COUPON_LIMITS, assertCouponWithinLimits } from '../couponLimits';
import { couponsService } from '../coupons.service';
import * as couponsController from '../coupons.controller';

const { maxPercent, maxFixedRupees, maxDiscountCapRupees } = COUPON_LIMITS;

const limitError = (e: unknown) => (e as { statusCode?: number }).statusCode === 422;

describe('assertCouponWithinLimits', () => {
  it('has the documented ceilings', () => {
    assert.deepEqual(COUPON_LIMITS, { maxPercent: 30, maxFixedRupees: 1000, maxDiscountCapRupees: 2000 });
  });

  it('allows ordinary coupons', () => {
    for (const coupon of [
      { type: 'PERCENTAGE', value: 10, maxDiscountCap: 500 },
      { type: 'PERCENTAGE', value: maxPercent, maxDiscountCap: maxDiscountCapRupees },
      { type: 'FLAT', value: 200 },
      { type: 'FLAT', value: maxFixedRupees },
      { type: 'CASHBACK', value: 150 },
      { type: 'BUNDLE', value: 300 },
      { type: 'FREE_SHIPPING' },
      { type: 'BOGO' },
      { type: 'TIERED', value: 10, maxDiscountCap: 800, config: { tiers: [{ percent: 5 }, { percent: maxPercent }] } },
      // The database returns DECIMALs as strings.
      { type: 'PERCENTAGE', value: '25.00', maxDiscountCap: '1500.00' },
    ]) {
      assert.doesNotThrow(() => assertCouponWithinLimits(coupon), JSON.stringify(coupon));
    }
  });

  it('refuses a percentage above the ceiling, including the 100%-off case', () => {
    for (const value of [maxPercent + 1, 50, 100]) {
      assert.throws(
        () => assertCouponWithinLimits({ type: 'PERCENTAGE', value, maxDiscountCap: 500 }),
        (e) => limitError(e) && /above 30%/.test((e as Error).message),
        `${value}%`,
      );
    }
  });

  it('refuses a fixed amount above the ceiling for FLAT, CASHBACK and BUNDLE', () => {
    for (const type of ['FLAT', 'CASHBACK', 'BUNDLE']) {
      assert.throws(
        () => assertCouponWithinLimits({ type, value: maxFixedRupees + 1 }),
        (e) => limitError(e) && /above ₹1000/.test((e as Error).message),
        type,
      );
    }
  });

  it('refuses a maximum discount above the ceiling for any type', () => {
    for (const type of ['PERCENTAGE', 'FLAT', 'TIERED', 'CASHBACK']) {
      assert.throws(
        () => assertCouponWithinLimits({ type, value: 5, maxDiscountCap: maxDiscountCapRupees + 1, config: { tiers: [{ percent: 5 }] } }),
        (e) => limitError(e) && /maximum discount above ₹2000/.test((e as Error).message),
        type,
      );
    }
  });

  it('requires percentage-style coupons to carry a maximum discount (otherwise the discount is unbounded)', () => {
    for (const coupon of [
      { type: 'PERCENTAGE', value: 10 },
      { type: 'PERCENTAGE', value: 10, maxDiscountCap: null },
      { type: 'TIERED', value: 10, config: { tiers: [{ percent: 10 }] } },
    ]) {
      assert.throws(() => assertCouponWithinLimits(coupon), (e) => limitError(e) && /need a maximum discount/.test((e as Error).message));
    }
  });

  it('checks every tier of a tiered coupon', () => {
    assert.throws(
      () => assertCouponWithinLimits({ type: 'TIERED', maxDiscountCap: 500, config: { tiers: [{ percent: 10 }, { percent: 45 }] } }),
      (e) => limitError(e) && /tier above 30%/.test((e as Error).message),
    );
    assert.throws(() => assertCouponWithinLimits({ type: 'TIERED', value: 60, maxDiscountCap: 500, config: { tiers: [] } }), limitError);
  });
});

const generous = {
  code: 'MEGA100',
  type: 'PERCENTAGE',
  value: 100,
  maxDiscountCap: 99999,
  startDate: '2026-12-01',
  endDate: '2026-12-31',
} as never;

describe('couponsService applies the ceilings only when asked', () => {
  afterEach(() => mock.restoreAll());

  it('createCoupon refuses an over-limit platform coupon before touching the database', async () => {
    const findOne = mock.method(Coupon, 'findOne', async () => null as never);
    await assert.rejects(couponsService.createCoupon(generous, 'actor-1', { enforceLimits: true }), limitError);
    assert.equal(findOne.mock.callCount(), 0, 'rejected before any lookup');
  });

  it('createCoupon lets the same coupon through when limits are not enforced (Super Admin)', async () => {
    // A taken code is a different, later failure: proof the ceilings were skipped.
    mock.method(Coupon, 'findOne', async () => ({ id: 'taken' }) as never);
    await assert.rejects(
      couponsService.createCoupon(generous, 'actor-1', { enforceLimits: false }),
      (e: { statusCode?: number }) => e.statusCode === 409,
    );
    await assert.rejects(couponsService.createCoupon(generous, 'actor-1'), (e: { statusCode?: number }) => e.statusCode === 409);
  });

  it('bulkGenerate refuses an over-limit template when enforced', async () => {
    await assert.rejects(
      couponsService.bulkGenerate({ name: 'Batch', count: 5, template: generous } as never, 'actor-1', { enforceLimits: true }),
      limitError,
    );
  });

  describe('updateCoupon', () => {
    const SENTINEL = new Error('REACHED_WRITE');
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'c1',
      code: 'BIG',
      type: 'PERCENTAGE',
      value: '40.00',
      maxDiscountCap: '1500.00',
      usedCount: 0,
      vendorId: null,
      config: {},
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-31'),
      update: async () => {
        throw SENTINEL;
      },
      ...over,
    });

    it('refuses an edit that makes a coupon more generous than the ceilings', async () => {
      mock.method(Coupon, 'findByPk', async () => stored({ value: '10.00' }) as never);
      await assert.rejects(couponsService.updateCoupon('c1', { value: 80 } as never, 'actor-1', { enforceLimits: true }), limitError);
      await assert.rejects(couponsService.updateCoupon('c1', { maxDiscountCap: 5000 } as never, 'actor-1', { enforceLimits: true }), limitError);
      await assert.rejects(couponsService.updateCoupon('c1', { type: 'FLAT', value: 5000 } as never, 'actor-1', { enforceLimits: true }), limitError);
    });

    it('does not block an unrelated edit of a coupon a Super Admin already made generous', async () => {
      mock.method(Coupon, 'findByPk', async () => stored() as never); // 40% / ₹1500 cap: above the 30% ceiling
      await assert.rejects(
        couponsService.updateCoupon('c1', { endDate: '2027-01-31' } as never, 'actor-1', { enforceLimits: true }),
        (e) => e === SENTINEL,
        'a date change must reach the write',
      );
    });

    it('lets Super Admin (no enforcement) make the edit', async () => {
      mock.method(Coupon, 'findByPk', async () => stored({ value: '10.00' }) as never);
      await assert.rejects(
        couponsService.updateCoupon('c1', { value: 80 } as never, 'actor-1', { enforceLimits: false }),
        (e) => e === SENTINEL,
      );
    });
  });
});

describe('the coupon controller enforces the ceilings on exactly the right actors', () => {
  afterEach(() => {
    mock.restoreAll();
    clearPermissionCache();
  });

  async function scopeFor(role: string, permissions: string[], vendorId: string | null = null) {
    setPermissionCache(`role-${role}`, permissions);
    const create = mock.method(couponsService, 'createCoupon', (async () => ({ id: 'c' })) as never);
    const body = { code: 'X1', type: 'FLAT', value: 10, startDate: '2026-12-01', endDate: '2026-12-31' };
    const req = { body, user: { id: 'u1', roleId: `role-${role}`, role: { name: role }, vendorId } } as unknown as Request;
    const res = { status: () => res, json: () => res } as unknown as Response;
    await new Promise<void>((resolve, reject) => {
      void couponsController.createCoupon(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
      setTimeout(resolve, 50);
    });
    return create.mock.calls[0]!.arguments[2] as { forceVendorId?: string; enforceLimits?: boolean };
  }

  it('Catalog Manager: limits enforced', async () => {
    const opts = await scopeFor(ROLES.ADMIN_CATALOG_MANAGER, [...ROLE_PERMISSIONS[ROLES.ADMIN_CATALOG_MANAGER]!]);
    assert.equal(opts.enforceLimits, true);
  });

  it('Super Admin: not limited', async () => {
    const opts = await scopeFor(ROLES.SUPER_ADMIN, [...ROLE_PERMISSIONS[ROLES.SUPER_ADMIN]!]);
    assert.equal(opts.enforceLimits, false);
  });

  it('a custom role granted coupon.unlimited: not limited; one with only coupon.manage: limited', async () => {
    assert.equal((await scopeFor('PROMO_LEAD', ['coupon.manage', 'coupon.unlimited'])).enforceLimits, false);
    assert.equal((await scopeFor('PROMO_DESK', ['coupon.manage'])).enforceLimits, true);
  });

  it('vendor owners create vendor-funded coupons: scoped to their store, platform ceilings do not apply', async () => {
    const opts = await scopeFor(ROLES.VENDOR_OWNER, [...ROLE_PERMISSIONS[ROLES.VENDOR_OWNER]!], 'vendor-1');
    assert.equal(opts.forceVendorId, 'vendor-1');
    assert.equal(opts.enforceLimits, undefined);
  });
});
