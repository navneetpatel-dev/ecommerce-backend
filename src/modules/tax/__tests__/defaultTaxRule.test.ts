import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { Category } from '@database/models/category.model';
import { TaxRule } from '@database/models/taxRule.model';
import { ValidationError } from '@core/errors/ValidationError';
import { taxRepository } from '@modules/tax/tax.repository';
import { taxService } from '@modules/tax/tax.service';

const CATEGORY = '11111111-1111-4111-8111-111111111111';
const status = (e: unknown) => (e as { statusCode?: number }).statusCode;

describe('tax rules: one per category, one default', () => {
  let audits: Array<Record<string, any>>;
  afterEach(() => mock.restoreAll());

  function setup(over: { existing?: number; categoryExists?: boolean; rule?: Record<string, unknown> | null } = {}) {
    audits = [];
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(Category, 'findByPk', async () => (over.categoryExists === false ? null : { id: CATEGORY, name: 'Apparel' }) as never);
    const count = mock.method(TaxRule, 'count', async () => (over.existing ?? 0) as never);
    const create = mock.method(TaxRule, 'create', async (row: Record<string, unknown>) => ({ id: 'r1', ...row }) as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return {} as never;
    });
    return { count, create };
  }

  it('refuses a second default rule and a second rule for a category (422), creating nothing', async () => {
    const { create } = setup({ existing: 1 });
    await assert.rejects(taxService.createTaxRule({ gstPercentage: 12 }, 'u1'), (e) => e instanceof ValidationError && /default/i.test((e as Error).message));
    await assert.rejects(taxService.createTaxRule({ categoryId: CATEGORY, gstPercentage: 12 }, 'u1'), (e) => status(e) === 422 && /already has a tax rule/.test((e as Error).message));
    assert.equal(create.mock.callCount(), 0);
  });

  it('a rule for an unknown category is a 404', async () => {
    setup({ categoryExists: false });
    await assert.rejects(taxService.createTaxRule({ categoryId: CATEGORY, gstPercentage: 12 }, 'u1'), (e) => status(e) === 404);
  });

  it('creates a category rule and audits it with the category name', async () => {
    const { create } = setup();
    await taxService.createTaxRule({ categoryId: CATEGORY, gstPercentage: 12, hsnCode: '6109' }, 'u1');
    assert.equal((create.mock.calls[0]!.arguments[0] as Record<string, unknown>).categoryId, CATEGORY);
    assert.equal(audits[0]!.action, 'TAX_RULE_CREATED');
    assert.equal(audits[0]!.metadata.categoryName, 'Apparel');
    assert.equal(audits[0]!.metadata.after.gstPercentage, 12);
  });

  it('moving a rule to another category checks that one too; staying put does not', async () => {
    const rule = { id: 'r1', categoryId: CATEGORY, gstPercentage: '12', hsnCode: null, priceBandThreshold: null, gstPercentageAbove: null, update: async function (patch: Record<string, unknown>) { Object.assign(this, patch); } };
    const { count } = setup({ existing: 1 });
    mock.method(TaxRule, 'findByPk', async () => rule as never);
    await assert.rejects(taxService.updateTaxRule('r1', { categoryId: '22222222-2222-4222-8222-222222222222' }, 'u1'), (e) => status(e) === 422);
    const before = count.mock.callCount();
    await taxService.updateTaxRule('r1', { categoryId: CATEGORY, gstPercentage: 18 }, 'u1');
    assert.equal(count.mock.callCount(), before, 'same category: no uniqueness check');
    assert.equal(audits.at(-1)!.action, 'TAX_RULE_UPDATED');
    assert.equal(audits.at(-1)!.metadata.before.gstPercentage, 12);
    assert.equal(audits.at(-1)!.metadata.after.gstPercentage, 18);
  });

  it('a rule can be made the default (categoryId null), refused when a default exists', async () => {
    const rule = { id: 'r1', categoryId: CATEGORY, gstPercentage: '12', update: async () => undefined };
    setup({ existing: 1 });
    mock.method(TaxRule, 'findByPk', async () => rule as never);
    await assert.rejects(taxService.updateTaxRule('r1', { categoryId: null }, 'u1'), (e) => status(e) === 422);
  });

  it('deleting the default rule needs force (it changes every category without its own rule)', async () => {
    const destroy = mock.fn(async () => undefined);
    setup();
    mock.method(TaxRule, 'findByPk', async () => ({ id: 'd1', categoryId: null, gstPercentage: '18', destroy }) as never);
    await assert.rejects(taxService.deleteTaxRule('d1', 'u1'), (e) => status(e) === 422 && /Confirm/.test((e as Error).message));
    assert.equal(destroy.mock.callCount(), 0);
    await taxService.deleteTaxRule('d1', 'u1', true);
    assert.equal(destroy.mock.callCount(), 1);
    assert.equal(audits.at(-1)!.action, 'TAX_RULE_DELETED');
  });

  it('a category rule deletes without force and records what it was', async () => {
    const destroy = mock.fn(async () => undefined);
    setup();
    mock.method(TaxRule, 'findByPk', async () => ({ id: 'r1', categoryId: CATEGORY, gstPercentage: '12', destroy }) as never);
    await taxService.deleteTaxRule('r1', 'u1');
    assert.equal(destroy.mock.callCount(), 1);
    assert.equal(audits.at(-1)!.metadata.before.gstPercentage, 12);
  });

  it('picks rules in a fixed order: oldest first, then lowest rate', async () => {
    const findOne = mock.method(TaxRule, 'findOne', async () => null);
    await taxRepository.findDefault();
    await taxRepository.findByCategory('c');
    for (const call of findOne.mock.calls) {
      const options = call.arguments[0] as { order?: unknown };
      assert.deepEqual(options.order, [['createdAt', 'ASC'], ['gstPercentage', 'ASC'], ['id', 'ASC']]);
    }
    assert.equal(findOne.mock.callCount(), 2);
  });
});
