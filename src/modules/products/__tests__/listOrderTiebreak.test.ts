import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sequelize } from '@database/models';
import { buildListOrder, productsRepository } from '../products.repository';

const SORTS = [undefined, 'newest', 'trending', 'popular', 'rating', 'price_asc', 'price_desc'];

describe('product list order', () => {
  it('ends every sort on the primary key so tied rows keep one order', () => {
    for (const sort of SORTS) {
      const order = buildListOrder(sort);
      assert.deepEqual(order[order.length - 1], ['id', 'ASC'], `sort ${sort ?? 'default'}`);
    }
  });

  it('never repeats a product across pages', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    for (const sort of SORTS) {
      const seen = new Set<string>();
      for (let page = 0; page < 5; page += 1) {
        const { rows } = await productsRepository.findVisibleList({ limit: 20, offset: page * 20, sort } as never);
        for (const row of rows) {
          assert.ok(!seen.has(row.id), `sort ${sort ?? 'default'}: ${row.id} repeated on page ${page + 1}`);
          seen.add(row.id);
        }
      }
    }
  });
});
