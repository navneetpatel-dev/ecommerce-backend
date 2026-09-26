import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { Op, UniqueConstraintError } from 'sequelize';
import { sequelize } from '@database/models';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { TdsLedger } from '@database/models/tdsLedger.model';

function indexNames(model: {
  options?: { indexes?: Array<{ name?: string; unique?: boolean; fields?: unknown }> };
}) {
  return (model.options?.indexes ?? []).map((idx) => ({
    name: idx.name,
    unique: idx.unique,
    fields: idx.fields,
  }));
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof UniqueConstraintError) return true;
  const code = (err as { original?: { code?: string }; parent?: { code?: string } })?.original?.code
    ?? (err as { parent?: { code?: string } })?.parent?.code;
  return code === '23505';
}

async function dbReady(): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch {
    return false;
  }
}

async function constraintInstalled(indexName: string): Promise<boolean> {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = :name LIMIT 1`,
    { replacements: { name: indexName } },
  );
  return (rows as unknown[]).length > 0;
}

describe('TCS/TDS ledger unique constraints', () => {
  after(async () => {
    await sequelize.close().catch(() => undefined);
  });

  it('declares one COLLECTION per sub-order and one RETURN_ADJUSTMENT per return', () => {
    const indexes = indexNames(TcsLedger);
    const collection = indexes.find((idx) => idx.name === 'tcs_ledgers_collection_sub_order_unique');
    assert.ok(collection);
    assert.equal(collection.unique, true);
    assert.deepEqual(collection.fields, ['subOrderId']);
    const adjustment = indexes.find((idx) => idx.name === 'tcs_ledgers_return_adjustment_unique');
    assert.ok(adjustment);
    assert.equal(adjustment.unique, true);
    assert.deepEqual(adjustment.fields, ['returnRequestId']);
    // The old per-sub-order index blocked a second return's adjustment.
    assert.equal(
      indexes.some((idx) => idx.name === 'tcs_ledgers_sub_order_entry_type_unique'),
      false,
    );
  });

  it('declares one TDS deduction per sub-order and one TDS row per commission ledger', () => {
    const indexes = indexNames(TdsLedger);
    const deduction = indexes.find((idx) => idx.name === 'tds_ledgers_sub_order_deduction_unique');
    assert.ok(deduction);
    assert.equal(deduction.unique, true);
    assert.deepEqual(deduction.fields, ['subOrderId']);
    const perLedger = indexes.find((idx) => idx.name === 'tds_ledgers_commission_ledger_unique');
    assert.ok(perLedger);
    assert.equal(perLedger.unique, true);
    assert.deepEqual(perLedger.fields, ['commissionLedgerId']);
    // The old index allowed no reversal row beside a sub-order's deduction.
    assert.equal(
      indexes.some((idx) => idx.name === 'tds_ledgers_sub_order_unique'),
      false,
    );
  });

  it('keeps the partial unique indexes, dedupe, and fail-loud queries in the migration', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(
      here,
      '../../../../database/migrations/20260917000002-tcs-tds-ledger-unique-constraints.js',
    );
    const blob = readFileSync(migrationPath, 'utf8');
    assert.ok(blob.includes('tcs_ledgers_sub_order_entry_type_unique'));
    assert.ok(blob.includes('tds_ledgers_sub_order_unique'));
    assert.ok(blob.includes("['subOrderId', 'entryType']"));
    assert.ok(blob.includes("['subOrderId']"));
    assert.ok(blob.includes('HAVING COUNT(*) > 1'));
    assert.ok(blob.includes('where: { deletedAt: null }'));
    assert.ok(blob.includes('ROW_NUMBER()'));
  });

  it('rejects a second COLLECTION, allows one RETURN_ADJUSTMENT per return', async (t) => {
    if (!(await dbReady())) return t.skip('database unavailable');
    if (!(await constraintInstalled('tcs_ledgers_return_adjustment_unique'))) {
      return t.skip('tcs unique indexes not installed');
    }

    const original = await TcsLedger.findOne({
      where: { entryType: 'COLLECTION' },
    });
    if (!original) return t.skip('no TCS COLLECTION fixture');

    const fields = {
      orderId: original.orderId,
      subOrderId: original.subOrderId,
      vendorId: original.vendorId,
      taxableAmountPaise: original.taxableAmountPaise,
      ratePercent: Number(original.ratePercent),
      tcsAmountPaise: original.tcsAmountPaise,
      tcsCgstPaise: original.tcsCgstPaise,
      tcsSgstPaise: original.tcsSgstPaise,
      tcsIgstPaise: original.tcsIgstPaise,
      period: original.period,
      section: original.section,
      vendorGstin: original.vendorGstin,
      placeOfSupplyState: original.placeOfSupplyState,
      returnRequestId: null as string | null,
      createdBy: original.createdBy,
      updatedBy: original.updatedBy,
      deletedBy: null as string | null,
    };

    await assert.rejects(
      () => TcsLedger.create({ ...fields, entryType: 'COLLECTION' }),
      isUniqueViolation,
    );

    // Inside a rolled-back transaction: two returns on the same sub-order each get
    // their adjustment; a retry of the same return is rejected.
    const [freeReturns] = await sequelize.query(
      `SELECT rr.id FROM return_requests rr
       WHERE NOT EXISTS (
         SELECT 1 FROM tcs_ledgers t
         WHERE t."returnRequestId" = rr.id AND t."deletedAt" IS NULL
       )
       ORDER BY rr.id
       LIMIT 2`,
    );
    const [returnA, returnB] = (freeReturns as Array<{ id: string }>).map((row) => row.id);
    if (!returnA || !returnB) return t.skip('needs two return requests without TCS adjustments');
    const adjustment = {
      ...fields,
      entryType: 'RETURN_ADJUSTMENT',
      tcsAmountPaise: -1,
      taxableAmountPaise: -100,
    };
    await sequelize
      .transaction(async (transaction) => {
        await TcsLedger.create({ ...adjustment, returnRequestId: returnA }, { transaction });
        await TcsLedger.create({ ...adjustment, returnRequestId: returnB }, { transaction });
        await assert.rejects(
          () =>
            sequelize.transaction({ transaction }, () =>
              TcsLedger.create({ ...adjustment, returnRequestId: returnA }, { transaction }),
            ),
          isUniqueViolation,
        );
        throw new Error('rollback-test');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== 'rollback-test') throw err;
      });
  });

  it('rejects a second TDS deduction for the same subOrderId', async (t) => {
    if (!(await dbReady())) return t.skip('database unavailable');
    if (!(await constraintInstalled('tds_ledgers_sub_order_deduction_unique'))) {
      return t.skip('tds unique index not installed');
    }

    const original = await TdsLedger.findOne({ where: { tdsAmountPaise: { [Op.gt]: 0 } } });
    if (!original) return t.skip('no TDS fixture');

    await assert.rejects(
      () =>
        TdsLedger.create({
          orderId: original.orderId,
          subOrderId: original.subOrderId,
          vendorId: original.vendorId,
          taxableAmountPaise: original.taxableAmountPaise,
          ratePercent: Number(original.ratePercent),
          tdsAmountPaise: original.tdsAmountPaise,
          payoutId: original.payoutId,
          section: original.section,
          period: original.period,
          createdBy: original.createdBy,
          updatedBy: original.updatedBy,
          deletedBy: null,
        }),
      isUniqueViolation,
    );
  });

  it('allows a TDS reversal beside the deduction, once per commission ledger', async (t) => {
    if (!(await dbReady())) return t.skip('database unavailable');
    if (!(await constraintInstalled('tds_ledgers_commission_ledger_unique'))) {
      return t.skip('tds unique index not installed');
    }
    const original = await TdsLedger.findOne({ where: { tdsAmountPaise: { [Op.gt]: 0 } } });
    if (!original) return t.skip('no TDS fixture');

    await sequelize
      .transaction(async (transaction) => {
        const reversal = {
          orderId: original.orderId,
          subOrderId: original.subOrderId,
          vendorId: original.vendorId,
          commissionLedgerId: '00000000-0000-4000-8000-000000000001',
          taxableAmountPaise: -1000,
          ratePercent: 1,
          tdsAmountPaise: -10,
          payoutId: original.payoutId,
          section: original.section,
          period: original.period,
          createdBy: null,
          updatedBy: null,
          deletedBy: null,
        };
        await TdsLedger.create(reversal, { transaction });
        await assert.rejects(
          () =>
            sequelize.transaction({ transaction }, () => TdsLedger.create(reversal, { transaction })),
          isUniqueViolation,
        );
        throw new Error('rollback-test');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== 'rollback-test') throw err;
      });
  });
});
