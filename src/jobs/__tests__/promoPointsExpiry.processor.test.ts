import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { WalletLedger } from '@database/models/walletLedger.model';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';
import { runPromoPointsExpiry } from '@jobs/promoPointsExpiry.processor';

describe('runPromoPointsExpiry', () => {
  afterEach(() => mock.restoreAll());

  it('skips when promotional TTL is disabled', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      promotionalPointsTtlDays: 0,
    }));
    mock.method(WalletLedger, 'findAll', async () => {
      throw new Error('should not query ledgers when TTL disabled');
    });

    const result = await runPromoPointsExpiry();
    assert.equal(result.expiredUsers, 0);
  });
});
