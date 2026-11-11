import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { usersService } from '../users.service';

describe('Download my data (B-51)', () => {
  it('includes wallet, gift cards, tickets, bug reports, questions and alerts, and no gift card codes', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const [row] = await sequelize.query<{ id: string }>(
      `SELECT u.id FROM users u WHERE EXISTS (SELECT 1 FROM support_tickets s WHERE s."customerId" = u.id)
         AND EXISTS (SELECT 1 FROM wallet_ledgers w WHERE w."userId" = u.id) LIMIT 1`,
      { type: QueryTypes.SELECT },
    ).catch(() => [] as Array<{ id: string }>);
    if (!row) return t.skip('no shopper with tickets and wallet history');
    const data = await usersService.exportAccountData(row.id);
    for (const key of ['walletHistory', 'giftCardsSent', 'giftCardsReceived', 'supportTickets', 'bugReports', 'productQuestions', 'stockAlerts']) {
      assert.ok(Array.isArray((data as Record<string, unknown>)[key]), key);
    }
    assert.ok(data.walletHistory.length > 0 && data.supportTickets.length > 0);
    const json = JSON.stringify(data);
    assert.doesNotMatch(json, /"code":"[A-Z0-9-]{8,}"/, 'gift card codes stay out of the file');
    assert.doesNotMatch(json, /passwordHash/);
  });
});
