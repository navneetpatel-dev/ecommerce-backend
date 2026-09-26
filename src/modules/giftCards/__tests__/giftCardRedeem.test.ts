import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { GiftCard } from '@database/models/giftCard.model';
import { GIFT_CARD_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';
import { giftCardsService } from '@modules/giftCards/giftCards.service';

describe('gift card redemption and the wallet limit', () => {
  afterEach(() => mock.restoreAll());

  function stub(balance: number) {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } }),
    );
    const updates: Array<Record<string, unknown>> = [];
    const card = {
      id: 'gc1',
      code: 'GIFT-ABCD',
      amount: 2000,
      status: GIFT_CARD_STATUS.ACTIVE,
      expiresAt: new Date(Date.now() + 86_400_000),
      update: async (values: Record<string, unknown>) => {
        updates.push(values);
        return card;
      },
    };
    mock.method(GiftCard, 'findOne', async () => card as never);
    mock.method(settingsService, 'getPlatformSettings', async () => ({ walletMaxBalancePoints: 50_000 }) as never);
    mock.method(walletService, 'getBalance', async () => balance);
    const credit = mock.method(walletService, 'credit', async () => ({}) as never);
    return { updates, credit };
  }

  it('refuses a card that would take the wallet past its limit and keeps the card', async () => {
    const { updates, credit } = stub(49_000);
    await assert.rejects(giftCardsService.redeem('u1', 'gift-abcd'));
    assert.equal(credit.mock.callCount(), 0);
    assert.deepEqual(updates, [], 'the card stays ACTIVE');
  });

  it('redeems a card that fits under the limit', async () => {
    const { updates, credit } = stub(48_000);
    await giftCardsService.redeem('u1', 'gift-abcd');
    assert.equal(credit.mock.callCount(), 1);
    assert.equal(updates[0]?.status, GIFT_CARD_STATUS.REDEEMED);
  });
});
