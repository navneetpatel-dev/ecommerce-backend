import assert from 'node:assert/strict';
import { after, afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { reverseFrozenLine, splitTaxAmount, type PricingLineBreakdown } from '@modules/pricing/pricing.engine';
import { persistTcsReturnAdjustmentLedger } from '../returns.service';

/** Mirrors returns.service.ts TcsLedger RETURN_ADJUSTMENT split. */
function returnTcsSplit(
  refundTcsPaise: number,
  taxBreakdown: { igst?: number } | null,
  subOrderTaxBreakdown: { igst?: number } | null,
) {
  const useIgst =
    Number(taxBreakdown?.igst ?? 0) > 0 || Number(subOrderTaxBreakdown?.igst ?? 0) > 0;
  const { cgst, sgst, igst } = splitTaxAmount(refundTcsPaise, !useIgst);
  return {
    tcsCgstPaise: -cgst,
    tcsSgstPaise: -sgst,
    tcsIgstPaise: -igst,
    tcsAmountPaise: -refundTcsPaise,
    useIgst,
  };
}

function frozenIntraLine(): PricingLineBreakdown {
  return {
    key: 'item',
    quantity: 2,
    unitPricePaise: 10100,
    lineSubtotalPaise: 20200,
    discountPaise: 0,
    taxablePaise: 20200,
    tax: { cgst: 1818, sgst: 1818, igst: 0, total: 3636, gstPercentage: 18 },
    commissionBasePaise: 20200,
    commissionPaise: 2020,
    tcsPaise: 202,
    netPayoutPaise: 17978,
  };
}

describe('TcsLedger RETURN_ADJUSTMENT split', () => {
  it('matches splitTaxAmount and is the negation of the equivalent COLLECTION split (intra, odd paise)', () => {
    const refundTcsPaise = 101;
    const ledger = returnTcsSplit(refundTcsPaise, { igst: 0 }, { igst: 0 });
    const forward = splitTaxAmount(refundTcsPaise, true);
    assert.equal(ledger.useIgst, false);
    assert.equal(ledger.tcsCgstPaise + ledger.tcsSgstPaise + ledger.tcsIgstPaise, ledger.tcsAmountPaise);
    assert.equal(ledger.tcsCgstPaise, -forward.cgst);
    assert.equal(ledger.tcsSgstPaise, -forward.sgst);
    assert.equal(ledger.tcsIgstPaise, -forward.igst);
    assert.equal(ledger.tcsCgstPaise, -50);
    assert.equal(ledger.tcsSgstPaise, -51);
    assert.equal(ledger.tcsIgstPaise + 0, 0);
  });

  it('puts the entire reversed TCS into IGST for an inter-state original collection', () => {
    const refundTcsPaise = 101;
    const ledger = returnTcsSplit(refundTcsPaise, { igst: 101 }, { igst: 101 });
    const forward = splitTaxAmount(refundTcsPaise, false);
    assert.equal(ledger.useIgst, true);
    assert.equal(ledger.tcsIgstPaise, -forward.igst);
    assert.equal(ledger.tcsCgstPaise + 0, 0);
    assert.equal(ledger.tcsSgstPaise + 0, 0);
    assert.equal(ledger.tcsIgstPaise, -101);
  });

  it('does not silently file an intra-state TCS reversal as IGST if useIgst polarity is inverted', () => {
    const refundTcsPaise = 101;
    const useIgst = false;
    const correct = splitTaxAmount(refundTcsPaise, !useIgst);
    const invertedWrong = splitTaxAmount(refundTcsPaise, useIgst);
    assert.deepEqual(correct, { cgst: 50, sgst: 51, igst: 0 });
    assert.deepEqual(invertedWrong, { cgst: 0, sgst: 0, igst: 101 });
    assert.notDeepEqual(correct, invertedWrong);
  });

  it('regression-locks reverseFrozenLine TCS against the RETURN_ADJUSTMENT split', () => {
    const line = frozenIntraLine();
    const half = reverseFrozenLine({ line, returnQuantity: 1 });
    const ledger = returnTcsSplit(half.refundTcsPaise, line.tax, { igst: 0 });
    const forward = splitTaxAmount(half.refundTcsPaise, true);
    assert.equal(half.refundTcsPaise, 101);
    assert.equal(ledger.tcsAmountPaise, -101);
    assert.equal(ledger.tcsCgstPaise, -forward.cgst);
    assert.equal(ledger.tcsSgstPaise, -forward.sgst);
    assert.equal(ledger.tcsIgstPaise + 0, 0);
  });
});

const transaction = {} as Transaction;

after(async () => {
  await sequelize.close().catch(() => undefined);
});

describe('persistTcsReturnAdjustmentLedger TcsLedger.create path', () => {
  afterEach(() => mock.restoreAll());

  it('creates a RETURN_ADJUSTMENT row that is the negation of splitTaxAmount (intra, odd paise)', async () => {
    const created: unknown[] = [];
    mock.method(TcsLedger, 'create', async (data: unknown) => {
      created.push(data);
      return data as TcsLedger;
    });

    const refundTcsPaise = 101;
    const row = await persistTcsReturnAdjustmentLedger(
      {
        refundTcsPaise,
        refundMerchandisePaise: 10100,
        itemIgst: 0,
        subOrderIgst: 0,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        originalTcs: { ratePercent: 1, vendorGstin: '29ABCDE1234F1Z5', placeOfSupplyState: 'KARNATAKA' },
        vendor: { gstNumber: '29ABCDE1234F1Z5', state: 'KARNATAKA' },
        fallbackRatePercent: 1,
        returnRequestId: '55555555-5555-5555-5555-555555555555',
        actorId: '44444444-4444-4444-4444-444444444444',
        issuedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      transaction,
    );

    assert.equal(created.length, 1);
    const forward = splitTaxAmount(refundTcsPaise, true);
    assert.equal(row.entryType, 'RETURN_ADJUSTMENT');
    assert.equal(row.tcsAmountPaise, -refundTcsPaise);
    assert.equal(row.tcsCgstPaise + row.tcsSgstPaise + row.tcsIgstPaise, row.tcsAmountPaise);
    assert.equal(row.tcsCgstPaise, -forward.cgst);
    assert.equal(row.tcsSgstPaise, -forward.sgst);
    assert.equal(row.tcsIgstPaise + 0, 0);
    assert.equal(row.tcsCgstPaise, -50);
    assert.equal(row.tcsSgstPaise, -51);
  });

  it('puts the entire reversed TCS into IGST for an inter-state original collection', async () => {
    mock.method(TcsLedger, 'create', async (data: unknown) => data as TcsLedger);
    const refundTcsPaise = 101;
    const row = await persistTcsReturnAdjustmentLedger(
      {
        refundTcsPaise,
        refundMerchandisePaise: 10100,
        itemIgst: 1818,
        subOrderIgst: 1818,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        originalTcs: { ratePercent: 1, vendorGstin: '27ABCDE1234F1Z5', placeOfSupplyState: 'MAHARASHTRA' },
        vendor: { gstNumber: '27ABCDE1234F1Z5', state: 'MAHARASHTRA' },
        fallbackRatePercent: 1,
        returnRequestId: '55555555-5555-5555-5555-555555555555',
        actorId: '44444444-4444-4444-4444-444444444444',
        issuedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      transaction,
    );
    const forward = splitTaxAmount(refundTcsPaise, false);
    assert.equal(row.tcsIgstPaise, -forward.igst);
    assert.equal(row.tcsIgstPaise, -101);
    assert.equal(row.tcsCgstPaise + 0, 0);
    assert.equal(row.tcsSgstPaise + 0, 0);
  });

  it('does not silently file an intra-state TCS reversal as IGST if useIgst polarity is inverted', async () => {
    mock.method(TcsLedger, 'create', async (data: unknown) => data as TcsLedger);
    const refundTcsPaise = 101;
    const row = await persistTcsReturnAdjustmentLedger(
      {
        refundTcsPaise,
        refundMerchandisePaise: 10100,
        itemIgst: 0,
        subOrderIgst: 0,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        originalTcs: null,
        vendor: { gstNumber: null, state: 'KARNATAKA' },
        fallbackRatePercent: 1,
        returnRequestId: '55555555-5555-5555-5555-555555555555',
        actorId: '44444444-4444-4444-4444-444444444444',
        issuedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      transaction,
    );
    const invertedWrong = splitTaxAmount(refundTcsPaise, false);
    assert.deepEqual(
      { cgst: row.tcsCgstPaise, sgst: row.tcsSgstPaise, igst: row.tcsIgstPaise + 0 },
      { cgst: -50, sgst: -51, igst: 0 },
    );
    assert.notDeepEqual(
      { cgst: -row.tcsCgstPaise, sgst: -row.tcsSgstPaise, igst: -row.tcsIgstPaise },
      invertedWrong,
    );
  });
});
