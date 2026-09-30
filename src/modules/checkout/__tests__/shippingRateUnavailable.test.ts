import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ERROR_CODES } from '@core/constants/errors';
import { AppError } from '@core/errors/AppError';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { buildVendorPricingRows, PLATFORM_VENDOR_ID } from '../vendorPricingPlan';

const settings = { defaultCommissionRate: 10, tcsRatePercent: 0 } as PlatformSettingsPayload;

/** One first-party line: `categoryId: null` keeps this off the tax/commission tables. */
function platformLine() {
  return {
    key: 'l1',
    vendorId: PLATFORM_VENDOR_ID,
    unitPrice: 500,
    quantity: 1,
    categoryId: null,
    weightGrams: 500,
  };
}

describe('checkout rejects an unservable delivery address', () => {
  afterEach(() => mock.restoreAll());

  it('throws a coded SHIPPING_RATE_UNAVAILABLE error the client can map', async () => {
    mock.method(shippingService, 'getRatesForQuote', async () => []);

    await assert.rejects(
      buildVendorPricingRows({
        lines: [platformLine()],
        destination: { pincode: '89352', state: 'Maharashtra' },
        shippingMethodByVendor: { [PLATFORM_VENDOR_ID]: 'STANDARD' },
        settings,
        onMissingRate: 'throw',
      }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, ERROR_CODES.SHIPPING_RATE_UNAVAILABLE);
        assert.equal(err.statusCode, 422);
        return true;
      },
    );
  });

  it('the cart preview degrades to an estimated rate instead of failing', async () => {
    mock.method(shippingService, 'getRatesForQuote', async () => []);

    const plan = await buildVendorPricingRows({
      lines: [platformLine()],
      destination: { pincode: '89352', state: 'Maharashtra' },
      shippingMethodByVendor: { [PLATFORM_VENDOR_ID]: 'STANDARD' },
      settings,
      onMissingRate: 'estimate',
    });

    assert.equal(plan.hasEstimatedShipping, true);
    assert.equal(plan.rows[0]!.shippingRateFound, false);
    assert.equal(plan.shippingTotal, 0);
  });

  it('a rate for the selected method is used as-is', async () => {
    mock.method(shippingService, 'getRatesForQuote', async () => [
      {
        method: 'STANDARD' as const,
        cost: 59,
        shippingDisplayKey: 'PAID' as const,
        estimatedDays: 5,
        freeShippingThreshold: null,
        zoneId: 'zone-1',
      },
    ]);

    const plan = await buildVendorPricingRows({
      lines: [platformLine()],
      destination: { pincode: '400001', state: 'Maharashtra' },
      shippingMethodByVendor: { [PLATFORM_VENDOR_ID]: 'STANDARD' },
      settings,
      onMissingRate: 'throw',
    });

    assert.equal(plan.rows[0]!.shippingRateFound, true);
    assert.equal(plan.shippingByVendor[PLATFORM_VENDOR_ID], 59);
  });
});
