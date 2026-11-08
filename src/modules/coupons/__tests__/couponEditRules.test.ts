import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { ValidationError } from '@core/errors/ValidationError';
import { AppError } from '@core/errors/AppError';
import { assertCouponCodeFree, assertCouponEditAllowed } from '../couponEditRules';

function coupon(fields: Partial<Record<string, unknown>> = {}): Coupon {
  return {
    id: 'c-1',
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: '10.00',
    discountBearer: 'PLATFORM',
    vendorId: null,
    usedCount: 0,
    config: null,
    startDate: new Date('2026-11-01T00:00:00Z'),
    endDate: new Date('2026-12-01T00:00:00Z'),
    ...fields,
  } as unknown as Coupon;
}

function fieldErrors(err: unknown): Record<string, string[]> {
  assert.ok(err instanceof ValidationError);
  return (err.validationDetails as { fieldErrors: Record<string, string[]> }).fieldErrors;
}

describe('coupon edit rules', () => {
  afterEach(() => mock.restoreAll());

  it('lets an unused coupon change anything that still makes a valid coupon', async () => {
    mock.method(Coupon, 'findOne', async () => null);
    await assertCouponEditAllowed(coupon(), { code: 'save15', type: 'FLAT', value: 150 }, { vendorScoped: false });
  });

  it('locks code, type, bearer and owner once the coupon has been used', async () => {
    const used = coupon({ usedCount: 3 });
    const err = await assertCouponEditAllowed(
      used,
      { code: 'OTHER', type: 'FLAT', discountBearer: 'VENDOR', vendorId: '11111111-1111-4111-8111-111111111111' },
      { vendorScoped: false },
    ).catch((e: unknown) => e);
    assert.deepEqual(Object.keys(fieldErrors(err)).sort(), ['code', 'discountBearer', 'type', 'vendorId']);
  });

  it('still lets a used coupon change its limits, dates and value', async () => {
    await assertCouponEditAllowed(
      coupon({ usedCount: 3 }),
      { code: 'save10', value: 20, usageLimitTotal: 50, endDate: '2027-01-01T00:00:00Z' },
      { vendorScoped: false },
    );
  });

  it('refuses a total limit below the uses so far', async () => {
    const err = await assertCouponEditAllowed(coupon({ usedCount: 5 }), { usageLimitTotal: 4 }, { vendorScoped: false }).catch(
      (e: unknown) => e,
    );
    assert.match(fieldErrors(err).usageLimitTotal![0]!, /5 uses/);
  });

  it('checks the whole coupon after the edit, not just the fields sent', async () => {
    const pastEnd = await assertCouponEditAllowed(coupon(), { startDate: '2026-12-15T00:00:00Z' }, { vendorScoped: false }).catch(
      (e: unknown) => e,
    );
    assert.ok(fieldErrors(pastEnd).endDate);
    const over100 = await assertCouponEditAllowed(coupon(), { value: 120 }, { vendorScoped: false }).catch((e: unknown) => e);
    assert.ok(fieldErrors(over100).value);
  });

  it('refuses a code another coupon (even a deleted one) already has', async () => {
    const lookup = mock.method(Coupon, 'findOne', async () => ({ id: 'c-2' }) as never);
    const err = await assertCouponCodeFree('taken', 'c-1').catch((e: unknown) => e);
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    const options = lookup.mock.calls[0]!.arguments[0] as { where: { code: string }; paranoid: boolean };
    assert.equal(options.where.code, 'TAKEN');
    assert.equal(options.paranoid, false);
  });
});
