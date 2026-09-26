import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorInvoiceSequence } from '@database/models/vendorInvoiceSequence.model';
import { settingsService } from '@modules/settings/settings.service';
import {
  createCommissionInvoiceForPayout,
  isCommissionCreditNote,
} from '../commissionInvoice.service';

const transaction = {
  LOCK: { UPDATE: 'UPDATE', SHARE: 'SHARE' },
} as unknown as Transaction;

/**
 * ₹5.61 commission at 18%: inter-state IGST 100.98 → 101 paise; intra-state CGST and
 * SGST are each 9% = 50.49 → 50 paise, equal, 100 in all.
 */
const REGRESSION_TAXABLE_PAISE = 561;
const REGRESSION_GST_PAISE = 101;
const REGRESSION_INTRA_GST_PAISE = 100;
const REGRESSION_INTRA = {
  cgstPaise: 50,
  sgstPaise: 50,
  igstPaise: 0,
  gstPaise: 100,
  totalPaise: 661,
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

  it('charges intra-state GST as equal CGST and SGST at half the rate each', async () => {
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
    assert.equal(invoice.cgstPaise, 50);
    assert.equal(invoice.sgstPaise, 50);
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
    assert.equal(invoice.cgstPaise, REGRESSION_INTRA.cgstPaise);
    assert.equal(invoice.sgstPaise, REGRESSION_INTRA.sgstPaise);
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
    assert.equal(invoice.igstPaise, REGRESSION_GST_PAISE);
  });

  it('locks the intra-state GST amounts', async () => {
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

  it('locks the inter-state GST amounts', async () => {
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

  it('issues a credit note giving the GST back when the payout commission is negative', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'KARNATAKA' });
    const note = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-2',
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-02-28'),
        commissionTaxablePaise: -REGRESSION_TAXABLE_PAISE,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.ok(note);
    assert.equal(isCommissionCreditNote(note), true);
    // The same amounts as the invoice, negative: −₹5.61 commission, −₹1.00 GST.
    assert.equal(note.gstPaise, -REGRESSION_INTRA_GST_PAISE);
    assert.equal(note.cgstPaise, -REGRESSION_INTRA.cgstPaise);
    assert.equal(note.sgstPaise, -REGRESSION_INTRA.sgstPaise);
    assert.equal(note.totalPaise, -REGRESSION_INTRA.totalPaise);
    assert.match(note.number, /CN/);
  });

  it('issues nothing when the payout carries no commission', async () => {
    mockInvoiceDeps({ platformState: 'KARNATAKA', vendorState: 'KARNATAKA' });
    const none = await createCommissionInvoiceForPayout(
      {
        vendorId: 'vendor-1',
        payoutId: 'payout-3',
        periodStart: new Date('2026-02-01'),
        periodEnd: new Date('2026-02-28'),
        commissionTaxablePaise: 0,
        actorId: 'actor-1',
      },
      transaction,
    );
    assert.equal(none, null);
  });
});
