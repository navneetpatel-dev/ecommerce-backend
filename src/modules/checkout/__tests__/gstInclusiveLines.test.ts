import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Vendor } from '@database/models/vendor.model';
import { taxService } from '@modules/tax/tax.service';
import { linesSubtotal } from '@modules/coupons/coupon.utils';
import { withGstInclusiveLineValues } from '../gstInclusiveLines';
import { priceVendorRows, type VendorPricingRow } from '../vendorPricingPlan';
import type { PlatformSettingsPayload } from '@modules/settings/settings.service';

describe('coupon lines valued as the bill shows them', () => {
  afterEach(() => mock.restoreAll());

  it('agrees with the displayed items total to the paisa', async () => {
    const vendor = { id: 'v1', state: 'MAHARASHTRA', commissionRate: 10 } as unknown as Vendor;
    mock.method(Vendor, 'findAll', async () => [vendor] as never);
    const lookup = mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: 5, gstPriceBand: null }));
    // ₹10.25 × 2 at 5%: ₹10.76 a piece (₹21.52 for two), but the bill charges GST on the
    // line — ₹20.50 + ₹1.03 = ₹21.53.
    const lines = await withGstInclusiveLineValues(
      [{ productId: 'p1', categoryId: 'c1', vendorId: 'v1', unitPrice: 10.25, quantity: 2 }],
      'KARNATAKA',
    );
    assert.equal(lines[0]!.unitPrice, 10.76);
    assert.equal(linesSubtotal(lines), 21.53);
    assert.equal(lookup.mock.callCount(), 1);

    const row: VendorPricingRow = {
      vendorId: 'v1',
      vendor,
      lines: [{ key: 'l1', vendorId: 'v1', unitPrice: 10.25, quantity: 2, categoryId: 'c1', weightGrams: 100 }],
      shippingCost: 0,
      shippingRateFound: true,
      gstPercentage: 5,
      commissionRatePercent: 10,
      lineRates: { l1: { gstPercentage: 5, gstPriceBand: null, commissionRatePercent: 10 } },
    };
    const { inclusiveByVendor } = priceVendorRows({
      rows: [row],
      shares: { vendorDiscountShares: {}, vendorShippingDiscountShares: {}, vendorBorneDiscountShares: {} },
      shippingStateCode: 'KARNATAKA',
      settings: { defaultCommissionRate: 10, tcsRatePercent: 0 } as PlatformSettingsPayload,
    });
    assert.equal(inclusiveByVendor.v1!.itemsPaise, 2_153);
  });
});
