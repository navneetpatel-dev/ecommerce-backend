import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { TaxRule } from '@database/models/taxRule.model';
import { ValidationError } from '@core/errors/ValidationError';
import { taxRepository } from '@modules/tax/tax.repository';
import { taxService } from '@modules/tax/tax.service';

describe('default tax rule', () => {
  afterEach(() => mock.restoreAll());

  it('refuses a second rule without a category', async () => {
    mock.method(taxRepository, 'countDefaults', async () => 1);
    const create = mock.method(TaxRule, 'create', async () => ({}) as never);
    await assert.rejects(taxService.createTaxRule({ gstPercentage: 12 }), ValidationError);
    assert.equal(create.mock.callCount(), 0);
  });

  it('picks rules in a fixed order: oldest first, then lowest rate', async () => {
    const findOne = mock.method(TaxRule, 'findOne', async () => null);
    await taxRepository.findDefault();
    await taxRepository.findByCategory('c');
    for (const call of findOne.mock.calls) {
      const options = call.arguments[0] as { order?: unknown };
      assert.deepEqual(options.order, [
        ['createdAt', 'ASC'],
        ['gstPercentage', 'ASC'],
        ['id', 'ASC'],
      ]);
    }
    assert.equal(findOne.mock.callCount(), 2);
  });
});
