import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { PlatformSetting } from '@database/models/platformSetting.model';
import { settingsService, type PlatformSettingsPayload } from '../settings.service';
import { UpdateSettingsSchema } from '../settings.dto';

const BASE = UpdateSettingsSchema.parse({
  defaultCommissionRate: 10,
  autoApproveProducts: false,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 499,
  supportEmail: 'support@example.com',
  supportHours: '9am–6pm IST',
  ticketReopenWindowDays: 7,
  bugVerifyWindowDays: 7,
  bugCloseWindowDays: 7,
}) as PlatformSettingsPayload;

describe('settingsService.updatePlatformSettings', () => {
  afterEach(() => mock.restoreAll());

  function stubTransaction() {
    mock.method(sequelize, 'transaction', async (callback: (t: { LOCK: { UPDATE: string }; afterCommit: () => void }) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' }, afterCommit: () => undefined }),
    );
  }

  it('audits against the settings row id (a uuid) and lists only the changed keys', async () => {
    stubTransaction();
    const stored = { id: 'row-uuid', value: { ...BASE, freeShippingThreshold: 499 }, update: mock.fn(async () => stored) };
    mock.method(PlatformSetting, 'findOne', async () => stored as never);
    const audit = mock.method(AuditLog, 'create', async () => ({}) as never);

    await settingsService.updatePlatformSettings({ ...BASE, freeShippingThreshold: 999 }, 'admin-1');

    const payload = audit.mock.calls[0]!.arguments[0] as { entityId: string; action: string; metadata: { keysUpdated: string[] } };
    assert.equal(payload.entityId, 'row-uuid');
    assert.equal(payload.action, 'PLATFORM_SETTINGS_UPDATED');
    assert.deepEqual(payload.metadata.keysUpdated, ['freeShippingThreshold']);
  });

  it('creates the row on first save', async () => {
    stubTransaction();
    mock.method(PlatformSetting, 'findOne', async () => null);
    const create = mock.method(PlatformSetting, 'create', async () => ({ id: 'new-row' }) as never);
    mock.method(AuditLog, 'create', async () => ({}) as never);

    await settingsService.updatePlatformSettings(BASE, 'admin-1');

    assert.equal(create.mock.callCount(), 1);
  });

  it('returns the wallet-aligned values every later read will show', async () => {
    stubTransaction();
    mock.method(PlatformSetting, 'findOne', async () => null);
    mock.method(PlatformSetting, 'create', async () => ({ id: 'new-row' }) as never);
    mock.method(AuditLog, 'create', async () => ({}) as never);

    // A preset above the cap raises the cap rather than leaving an unpayable preset.
    const saved = await settingsService.updatePlatformSettings(
      { ...BASE, walletMaxRechargeInr: 1000, walletRechargePresetsInr: [5000, 500, 500] },
      'admin-1',
    );

    assert.deepEqual(saved.walletRechargePresetsInr, [500, 5000]);
    assert.equal(saved.walletMaxRechargeInr, 5000);
  });

  it('dedupes recipients case-insensitively and report types', async () => {
    stubTransaction();
    mock.method(PlatformSetting, 'findOne', async () => null);
    mock.method(PlatformSetting, 'create', async () => ({ id: 'new-row' }) as never);
    mock.method(AuditLog, 'create', async () => ({}) as never);

    const saved = await settingsService.updatePlatformSettings(
      { ...BASE, scheduledReportsRecipients: ['A@x.com', 'a@x.com ', 'b@x.com'], scheduledReportsTypes: ['gmv-sales', 'gmv-sales'] },
      'admin-1',
    );

    assert.deepEqual(saved.scheduledReportsRecipients, ['a@x.com', 'b@x.com']);
    assert.deepEqual(saved.scheduledReportsTypes, ['gmv-sales']);
  });

  it('rejects report types the engine cannot schedule', async () => {
    await assert.rejects(
      settingsService.updatePlatformSettings({ ...BASE, scheduledReportsTypes: ['definitely-not-a-report'] }, 'admin-1'),
      /cannot be scheduled/,
    );
  });
});
