import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Coupon, sequelize } from '@database/models';
import { couponsService } from '../coupons.service';

const search = (term: string) => couponsService.listCoupons({ page: 1, limit: 20, search: term });

describe('coupon list search', () => {
  it('finds a coupon by part of its code, whatever the case', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const coupon = await Coupon.findOne({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    if (!coupon) return t.skip('no coupons in this database');

    const { coupons } = await search(`  ${coupon.code.toLowerCase()}  `);
    assert.ok(coupons.some((row) => row.code === coupon.code));
  });

  it('matches % and _ literally instead of as wildcards', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const { coupons } = await search('%_%_%');
    assert.deepEqual(coupons, []);
  });
});
