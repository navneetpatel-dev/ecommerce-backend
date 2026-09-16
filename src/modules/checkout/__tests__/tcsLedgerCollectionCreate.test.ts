import assert from 'node:assert/strict';
import { after, afterEach, describe, it, mock } from 'node:test';
import type { Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { splitTaxAmount } from '@modules/pricing/pricing.engine';
import { persistTcsCollectionLedger } from '../checkout.service';

const transaction = {} as Transaction;

after(async () => {
  await sequelize.close().catch(() => undefined);
});

describe('persistTcsCollectionLedger TcsLedger.create path', () => {
  afterEach(() => mock.restoreAll());

  it('creates an intra-state COLLECTION row whose CGST/SGST split matches splitTaxAmount (odd paise)', async () => {
    const created: unknown[] = [];
    mock.method(TcsLedger, 'create', async (data: unknown) => {
      created.push(data);
      return data as TcsLedger;
    });

    const tcsTotal = 101;
    const row = await persistTcsCollectionLedger(
      {
        tcsTotal,
        taxIgst: 0,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        taxableAmountPaise: 10100,
        ratePercent: 1,
        vendorGstin: '29ABCDE1234F1Z5',
        placeOfSupplyState: 'KARNATAKA',
        actorId: '44444444-4444-4444-4444-444444444444',
      },
      transaction,
    );

    assert.equal(created.length, 1);
    const expected = splitTaxAmount(tcsTotal, true);
    assert.equal(row.entryType, 'COLLECTION');
    assert.equal(row.tcsAmountPaise, tcsTotal);
    assert.equal(row.tcsCgstPaise + row.tcsSgstPaise + row.tcsIgstPaise, row.tcsAmountPaise);
    assert.equal(row.tcsCgstPaise, expected.cgst);
    assert.equal(row.tcsSgstPaise, expected.sgst);
    assert.equal(row.tcsIgstPaise, expected.igst);
    assert.equal(row.tcsCgstPaise, 50);
    assert.equal(row.tcsSgstPaise, 51);
    assert.equal(row.tcsIgstPaise, 0);
  });

  it('creates an inter-state COLLECTION row with the entire TCS in IGST', async () => {
    mock.method(TcsLedger, 'create', async (data: unknown) => data as TcsLedger);

    const tcsTotal = 101;
    const row = await persistTcsCollectionLedger(
      {
        tcsTotal,
        taxIgst: 1818,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        taxableAmountPaise: 10100,
        ratePercent: 1,
        vendorGstin: '27ABCDE1234F1Z5',
        placeOfSupplyState: 'MAHARASHTRA',
        actorId: '44444444-4444-4444-4444-444444444444',
      },
      transaction,
    );

    const expected = splitTaxAmount(tcsTotal, false);
    assert.equal(row.entryType, 'COLLECTION');
    assert.equal(row.tcsIgstPaise, expected.igst);
    assert.equal(row.tcsIgstPaise, tcsTotal);
    assert.equal(row.tcsCgstPaise, 0);
    assert.equal(row.tcsSgstPaise, 0);
  });

  it('does not silently file intra-state TCS as IGST if useIgst polarity is inverted', async () => {
    mock.method(TcsLedger, 'create', async (data: unknown) => data as TcsLedger);
    const tcsTotal = 101;
    const row = await persistTcsCollectionLedger(
      {
        tcsTotal,
        taxIgst: 0,
        orderId: '11111111-1111-1111-1111-111111111111',
        subOrderId: '22222222-2222-2222-2222-222222222222',
        vendorId: '33333333-3333-3333-3333-333333333333',
        taxableAmountPaise: 10100,
        ratePercent: 1,
        vendorGstin: null,
        placeOfSupplyState: 'KARNATAKA',
        actorId: '44444444-4444-4444-4444-444444444444',
      },
      transaction,
    );
    const invertedWrong = splitTaxAmount(tcsTotal, false);
    assert.deepEqual(
      { cgst: row.tcsCgstPaise, sgst: row.tcsSgstPaise, igst: row.tcsIgstPaise },
      { cgst: 50, sgst: 51, igst: 0 },
    );
    assert.notDeepEqual(
      { cgst: row.tcsCgstPaise, sgst: row.tcsSgstPaise, igst: row.tcsIgstPaise },
      invertedWrong,
    );
  });
});
