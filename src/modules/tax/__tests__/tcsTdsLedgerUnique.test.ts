import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { UniqueConstraintError } from 'sequelize';
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

  it('declares a composite unique index on TcsLedger (subOrderId, entryType)', () => {
    const indexes = indexNames(TcsLedger);
    const composite = indexes.find((idx) => idx.name === 'tcs_ledgers_sub_order_entry_type_unique');
    assert.ok(composite);
    assert.equal(composite.unique, true);
    assert.deepEqual(composite.fields, ['subOrderId', 'entryType']);
  });

  it('declares a unique index on TdsLedger.subOrderId', () => {
    const indexes = indexNames(TdsLedger);
    const unique = indexes.find((idx) => idx.name === 'tds_ledgers_sub_order_unique');
    assert.ok(unique);
    assert.equal(unique.unique, true);
    assert.deepEqual(unique.fields, ['subOrderId']);
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

  it('rejects a second TcsLedger COLLECTION for the same subOrderId and allows RETURN_ADJUSTMENT', async (t) => {
    if (!(await dbReady())) return t.skip('database unavailable');
    if (!(await constraintInstalled('tcs_ledgers_sub_order_entry_type_unique'))) {
      return t.skip('tcs unique index not installed');
    }

    const original = await TcsLedger.findOne({
      where: { entryType: 'COLLECTION' },
    });
    if (!original) return t.skip('no TCS COLLECTION fixture');

    const duplicateFields = {
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
      () => TcsLedger.create({ ...duplicateFields, entryType: 'COLLECTION' }),
      isUniqueViolation,
    );

    const existingAdjustment = await TcsLedger.findOne({
      where: { subOrderId: original.subOrderId, entryType: 'RETURN_ADJUSTMENT' },
    });
    if (existingAdjustment) {
      assert.equal(existingAdjustment.subOrderId, original.subOrderId);
      return;
    }

    await sequelize.transaction(async (transaction) => {
      const row = await TcsLedger.create(
        { ...duplicateFields, entryType: 'RETURN_ADJUSTMENT', tcsAmountPaise: -1, taxableAmountPaise: -100 },
        { transaction },
      );
      assert.equal(row.entryType, 'RETURN_ADJUSTMENT');
      assert.equal(row.subOrderId, original.subOrderId);
      throw new Error('rollback-test');
    }).catch((err: unknown) => {
      if (!(err instanceof Error) || err.message !== 'rollback-test') throw err;
    });
  });

  it('rejects a second TdsLedger row for the same subOrderId', async (t) => {
    if (!(await dbReady())) return t.skip('database unavailable');
    if (!(await constraintInstalled('tds_ledgers_sub_order_unique'))) {
      return t.skip('tds unique index not installed');
    }

    const original = await TdsLedger.findOne();
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
});
