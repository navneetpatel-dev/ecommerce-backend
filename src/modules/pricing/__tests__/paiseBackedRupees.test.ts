/**
 * The rupee attributes on SubOrder / OrderItem / CommissionLedger are derived from the
 * paise columns (the only stored value). They must read exactly like the dropped
 * DECIMAL(10, 2) columns did, so API responses keep their shape.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { sequelize } from '@database/models';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';

describe('paise-backed rupee attributes', () => {
  it('read as the 2-decimal string the DECIMAL column returned', () => {
    const sub = SubOrder.build({ orderId: 'o', subtotalPaise: 12345, taxAmountPaise: -5 } as never);
    assert.equal(sub.subtotal as unknown, '123.45');
    assert.equal(sub.taxAmount as unknown, '-0.05');
    const plain = sub.get({ plain: true }) as unknown as Record<string, unknown>;
    assert.equal(plain.subtotal, '123.45');
    assert.equal(JSON.parse(JSON.stringify(sub)).subtotal, '123.45');
  });

  it('read BIGINT strings from Postgres', () => {
    const item = OrderItem.build({ unitPricePaise: '19999' as never } as never);
    assert.equal(item.unitPrice as unknown, '199.99');
  });

  it('store a rupee write as paise', () => {
    const ledger = CommissionLedger.build({ saleAmount: '1000.50', commissionAmount: 100 } as never);
    assert.equal(ledger.saleAmountPaise, 100050);
    assert.equal(ledger.commissionAmountPaise, 10000);
    ledger.set('netPayoutAmount', 0.07 as never);
    assert.equal(ledger.netPayoutAmountPaise, 7);
  });

  it('refuse a value that is not an amount', () => {
    assert.throws(() => SubOrder.build({ subtotal: 'abc' } as never), /not a rupee amount/);
  });

  describe('with a database', () => {
    let dbReady = false;
    before(async () => {
      try {
        await Promise.race([
          sequelize.authenticate(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        dbReady = true;
      } catch {
        dbReady = false;
      }
    });

    it('load the paise column when only the rupee name is selected', async (t) => {
      if (!dbReady) return t.skip('database unavailable');
      const row = await SubOrder.findOne({ attributes: ['id', 'subtotal'] });
      if (!row) return t.skip('no sub-orders seeded');
      assert.match(String(row.subtotal), /^-?\d+\.\d{2}$/);
      assert.equal(Number(row.subtotal), Number(row.subtotalPaise) / 100);
    });
  });
});
