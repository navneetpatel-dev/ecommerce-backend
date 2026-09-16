import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';
import { splitTaxAmount } from '@modules/pricing/pricing.engine';
import { settingsService } from '@modules/settings/settings.service';
import { createCommissionInvoiceForPayout } from '../commissionInvoice.service';

const transaction = {
  LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' },
} as unknown as Transaction;

/** Pre-refactor snapshot: commissionTaxablePaise=561 @ 18% → gstPaise=101 (odd). */
const REGRESSION_TAXABLE_PAISE = 561;
const REGRESSION_GST_PAISE = 101;
const REGRESSION_INTRA = {
  cgstPaise: 50,
  sgstPaise: 51,
  igstPaise: 0,
  gstPaise: 101,
  totalPaise: 662,
};
const REGRESSION_INTER = {
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 101,
  gstPaise: 101,
  totalPaise: 662,
};

function mockInvoiceDeps(opts: { platformState: string; vendorState: string | null }) {
  mock.method(CommissionInvoice, 'findOne', async () => null);
  mock.method(CommissionInvoice, 'create', async (data: unknown) => data);
  mock.method(Vendor, 'findByPk', async () =>
    opts.vendorState === null
      ? null
      : ({
          id: 'vendor-1',
          state: opts.vendorState,
          gstNumber: '29ABCDE1234F1Z5',
          businessName: 'Test Vendor',
        } as Vendor),
  );
  mock.method(settingsService, 'getPlatformSettings', async () => ({
    commissionGstRatePercent: 18,
    platformState: opts.platformState,
    platformGstin: '29AAAAA0000A1Z5',
    platformLegalName: 'Platform',
  }));
  mock.method(VendorInvoiceSequence, 'findOne', async () => ({
    nextValue: 1,
    update: async () => undefined,
  }));
}

describe('createCommissionInvoiceForPayout GST split', () => {
  afterEach(() => mock.restoreAll());

  it('splits intra-state GST into CGST+SGST, including the odd-paise remainder on SGST', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'KARNATAKA' });
    const invoice = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        commissionTaxablePaise: REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(invoice);
    assert.equal(invoice.cgstPaise + invoice.sgstPaise, invoice.gstPaise);
    assert.equal(invoice.igstPaise, 0);
    const expected = splitTaxAmount(REGRESSION_GST_PAISE, true);
    assert.equal(invoice.cgstPaise, expected.cgst);
    assert.equal(invoice.sgstPaise, expected.sgst);
    assert.equal(invoice.igstPaise, expected.igst);
    assert.equal(invoice.cgstPaise, 50);
    assert.equal(invoice.sgstPaise, 51);
  });

  it('defaults to CGST/SGST when platform state is unset', async () => {
    mockInvoiceDeps({ platformState: '', vendorState: 'MAHARASHTRA' });
    const invoice = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        commissionTaxablePaise: REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(invoice);
    assert.equal(invoice.igstPaise, 0);
    assert.equal(invoice.cgstPaise + invoice.sgstPaise, invoice.gstPaise);
    const expected = splitTaxAmount(REGRESSION_GST_PAISE, true);
    assert.equal(invoice.cgstPaise, expected.cgst);
    assert.equal(invoice.sgstPaise, expected.sgst);
  });

  it('puts the entire GST into IGST for an inter-state vendor', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'MAHARASHTRA' });
    const invoice = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-1',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        commissionTaxablePaise: REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(invoice);
    assert.equal(invoice.igstPaise, invoice.gstPaise);
    assert.equal(invoice.cgstPaise, 0);
    assert.equal(invoice.sgstPaise, 0);
    const expected = splitTaxAmount(REGRESSION_GST_PAISE, false);
    assert.equal(invoice.igstPaise, expected.igst);
  });

  it('regression-locks intra-state GST split to the pre-refactor snapshot', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'KARNATAKA' });
    const invoice = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-intra',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        commissionTaxablePaise: REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(invoice);
    assert.deepEqual(
      {
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        gstPaise: invoice.gstPaise,
        totalPaise: invoice.totalPaise,
      },
      REGRESSION_INTRA,
    );
  });

  it('regression-locks inter-state GST split to the pre-refactor snapshot', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'MAHARASHTRA' });
    const invoice = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-inter',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-01-31'),
        commissionTaxablePaise: REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(invoice);
    assert.deepEqual(
      {
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        gstPaise: invoice.gstPaise,
        totalPaise: invoice.totalPaise,
      },
      REGRESSION_INTER,
    );
  });
});
