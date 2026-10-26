import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { Vendor } from '@database/models/vendor.model';
import { settingsService } from '@modules/settings/settings.service';
import { payoutRatesFromSettings, vendorPayoutBreakdown } from '@modules/pricing/vendorPayout';
import { vendorPayablePaise } from '../engine/vendorPayable';

describe('vendorPayablePaise for settled ledgers', () => {
  afterEach(() => mock.restoreAll());

  it("uses the commission GST rate the payout charged, not today's", async () => {
    const row = {
      vendorId: 'vendor-1',
      netPayoutAmountPaise: 90000,
      commissionAmountPaise: 10000,
      taxableAmountPaise: 100000,
      supplyTaxablePaise: 100000,
      tdsRatePercent: 0,
      status: 'SETTLED',
      referenceType: null,
      payoutId: 'payout-1',
    };
    mock.method(CommissionLedger, 'findAll', async () => [row] as never);
    mock.method(Vendor, 'findAll', async () => [{ id: 'vendor-1', state: null }] as never);
    // GST on commission went up to 18% after this payout charged 12%.
    mock.method(settingsService, 'getPlatformSettings', async () => ({ commissionGstRatePercent: 18, tdsRatePercent: 0 }) as never);
    mock.method(CommissionInvoice, 'findAll', async () => [{ payoutId: 'payout-1', gstRatePercent: 12 }] as never);

    const paid = await vendorPayablePaise(['vendor-1'], { status: 'SETTLED', from: new Date(0), to: new Date() });

    const atPayoutRate = vendorPayoutBreakdown([row] as never, payoutRatesFromSettings({ commissionGstRatePercent: 12 }, null));
    const atTodaysRate = vendorPayoutBreakdown([row] as never, payoutRatesFromSettings({ commissionGstRatePercent: 18 }, null));
    assert.notEqual(atPayoutRate.payoutPaise, atTodaysRate.payoutPaise);
    assert.equal(paid.get('vendor-1'), atPayoutRate.payoutPaise);
  });
});
