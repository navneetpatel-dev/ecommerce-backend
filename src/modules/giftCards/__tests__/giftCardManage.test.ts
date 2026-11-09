import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Op } from 'sequelize';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { GiftCard } from '@database/models/giftCard.model';
import { GIFT_CARD_STATUS } from '@core/constants/statuses';
import { giftCardsAdminService } from '@modules/giftCards/giftCardsAdmin.service';
import { giftCardAccountsService } from '@modules/giftCards/giftCardAccounts.service';
import { effectiveGiftCardStatus } from '@modules/giftCards/giftCardViews';

const DAY = 86_400_000;

function card(overrides: Record<string, unknown> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const row = {
    id: 'gc1',
    code: 'GIFTABCD1234',
    amount: '1500.00',
    status: GIFT_CARD_STATUS.ACTIVE,
    purchaserId: 'buyer',
    recipientEmail: 'friend@example.com',
    recipientName: null,
    message: null,
    paidAt: new Date(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + DAY),
    redeemedAt: null,
    update: async (values: Record<string, unknown>) => {
      updates.push(values);
      Object.assign(row, values);
      return row;
    },
    ...overrides,
  };
  return { row, updates };
}

function stubTransaction() {
  mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
    callback({ LOCK: { UPDATE: 'UPDATE' } }),
  );
}

describe('effective gift card status', () => {
  it('reads an ACTIVE card past its expiry as EXPIRED and leaves the rest alone', () => {
    const past = new Date(Date.now() - DAY);
    assert.equal(effectiveGiftCardStatus({ status: 'ACTIVE', expiresAt: past } as never), 'EXPIRED');
    assert.equal(effectiveGiftCardStatus({ status: 'REDEEMED', expiresAt: past } as never), 'REDEEMED');
    assert.equal(effectiveGiftCardStatus({ status: 'ACTIVE', expiresAt: new Date(Date.now() + DAY) } as never), 'ACTIVE');
  });
});

describe('admin gift card deactivation', () => {
  afterEach(() => mock.restoreAll());

  it('cancels an active card and writes the reason to the audit log', async () => {
    stubTransaction();
    const { row, updates } = card();
    mock.method(GiftCard, 'findByPk', async () => row as never);
    const audits: Array<Record<string, unknown>> = [];
    mock.method(AuditLog, 'create', async (values: Record<string, unknown>) => {
      audits.push(values);
      return {} as never;
    });

    const view = await giftCardsAdminService.cancel('admin1', 'gc1', 'Reported as fraud');
    assert.equal(view.status, GIFT_CARD_STATUS.CANCELLED);
    assert.equal(updates[0]?.status, GIFT_CARD_STATUS.CANCELLED);
    assert.equal(audits[0]?.action, 'GIFT_CARD_CANCELLED');
    assert.equal((audits[0]?.metadata as { reason: string }).reason, 'Reported as fraud');
  });

  for (const [label, overrides] of [
    ['redeemed', { status: GIFT_CARD_STATUS.REDEEMED }],
    ['already cancelled', { status: GIFT_CARD_STATUS.CANCELLED }],
    ['past its expiry', { expiresAt: new Date(Date.now() - DAY) }],
  ] as const) {
    it(`refuses a card that is ${label}`, async () => {
      stubTransaction();
      const { row, updates } = card(overrides);
      mock.method(GiftCard, 'findByPk', async () => row as never);
      await assert.rejects(giftCardsAdminService.cancel('admin1', 'gc1', 'reason'), { statusCode: 409 });
      assert.deepEqual(updates, []);
    });
  }
});

describe('admin gift card list filters by the status it shows', () => {
  afterEach(() => mock.restoreAll());

  async function whereFor(status: string) {
    const calls: Array<{ where: Record<symbol, unknown[]> }> = [];
    mock.method(GiftCard, 'findAndCountAll', async (options: { where: Record<symbol, unknown[]> }) => {
      calls.push(options);
      return { rows: [], count: 0 } as never;
    });
    await giftCardsAdminService.list({ page: 1, limit: 20, status: status as never });
    return calls[0]!.where[Op.and]![0] as Record<string | symbol, unknown>;
  }

  it('ACTIVE excludes cards past their expiry', async () => {
    const where = await whereFor('ACTIVE');
    assert.equal(where.status, 'ACTIVE');
    assert.ok((where.expiresAt as Record<symbol, Date>)[Op.gte] instanceof Date);
  });

  it('EXPIRED includes ACTIVE cards past their expiry', async () => {
    const where = await whereFor('EXPIRED');
    const either = where[Op.or] as Array<Record<string, unknown>>;
    assert.deepEqual(either[0], { status: 'EXPIRED' });
    assert.equal(either[1]?.status, 'ACTIVE');
  });
});

describe('resending a gift card', () => {
  afterEach(() => mock.restoreAll());

  it("refuses someone else's card as not found", async () => {
    const { row } = card({ purchaserId: 'someone-else' });
    mock.method(GiftCard, 'findByPk', async () => row as never);
    await assert.rejects(giftCardAccountsService.resend('buyer', 'gc1'), { statusCode: 404 });
  });

  it('refuses a card that can no longer be redeemed', async () => {
    const { row } = card({ status: GIFT_CARD_STATUS.REDEEMED });
    mock.method(GiftCard, 'findByPk', async () => row as never);
    await assert.rejects(giftCardAccountsService.resend('buyer', 'gc1'), { statusCode: 409 });
  });
});
