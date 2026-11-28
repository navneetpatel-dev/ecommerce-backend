import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sequelize } from '@database/models';
import { returnsService } from '@modules/returns/returns.service';
import { subordersService } from '@modules/suborders/suborders.service';

/** These searches are hand-written SQL, so only a real query proves their columns exist. */
describe('order and return list search', () => {
  const terms = ['a', '%_', "o'brien"];
  const query = (search: string) => ({ page: 1, limit: 5, search });

  it('searches sub-orders without a database error', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    for (const term of terms) await assert.doesNotReject(subordersService.list(null, query(term)));
  });

  it('searches returns, for the platform and for one vendor, without a database error', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const vendorId = '00000000-0000-0000-0000-000000000000';
    for (const term of terms) {
      await assert.doesNotReject(returnsService.listAll(query(term)));
      await assert.doesNotReject(returnsService.listForVendor(vendorId, query(term)));
    }
  });
});
