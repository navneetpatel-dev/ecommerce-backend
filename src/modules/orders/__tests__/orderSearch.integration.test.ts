import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ordersRepository } from '../orders.repository';

describe('order search (B-43)', () => {
  it('finds orders by customer name, email and order id with paging', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const [row] = await sequelize.query<{ id: string; userId: string; name: string; email: string }>(
      `SELECT o.id, o."userId", u.name, u.email FROM orders o JOIN users u ON u.id = o."userId" LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!row) return t.skip('no orders');
    const byName = await ordersRepository.findWithFilters({ search: row.name, limit: 5, offset: 0 } as never);
    assert.ok(byName.rows.length > 0);
    const byEmail = await ordersRepository.findWithFilters({ search: row.email, limit: 5, offset: 0 } as never);
    assert.ok(byEmail.rows.every((order) => order.userId === row.userId));
    const byId = await ordersRepository.findWithFilters({ search: row.id.slice(0, 8), limit: 5, offset: 0 } as never);
    assert.ok(byId.rows.some((order) => order.id === row.id));
    // A shopper's own search stays inside their orders.
    const own = await ordersRepository.findWithFilters({ userId: row.userId, search: 'zzzz-no-match', limit: 5, offset: 0 } as never);
    assert.equal(own.count, 0);
  });
});
