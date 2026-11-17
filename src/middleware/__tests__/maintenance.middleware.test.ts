import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { settingsService } from '@modules/settings/settings.service';
import { blockNewPurchasesDuringMaintenance, MAINTENANCE_ERROR_CODE } from '../maintenance.middleware';

function run(user: unknown) {
  let captured: unknown;
  return blockNewPurchasesDuringMaintenance({ user } as Request, {} as Response, (error?: unknown) => {
    captured = error;
  }).then(() => captured as { statusCode?: number; code?: string; message?: string } | undefined);
}

describe('blockNewPurchasesDuringMaintenance', () => {
  afterEach(() => mock.restoreAll());

  const settings = (maintenanceEnabled: boolean, maintenanceMessage = '') =>
    mock.method(settingsService, 'getPlatformSettings', async () => ({ maintenanceEnabled, maintenanceMessage }) as never);

  it('lets everyone through while maintenance is off', async () => {
    settings(false);
    assert.equal(await run({ role: { name: 'CUSTOMER' } }), undefined);
  });

  it('answers customers with 503 and the admin message while maintenance is on', async () => {
    settings(true, 'Back at 6pm');
    const error = await run({ role: { name: 'CUSTOMER' } });
    assert.equal(error?.statusCode, 503);
    assert.equal(error?.code, MAINTENANCE_ERROR_CODE);
    assert.equal(error?.message, 'Back at 6pm');
  });

  it('falls back to a default message when none is set', async () => {
    settings(true, '   ');
    assert.match((await run({ role: { name: 'CUSTOMER' } }))?.message ?? '', /under maintenance/);
  });

  it('lets staff through so the store can be verified', async () => {
    settings(true);
    assert.equal(await run({ role: { name: 'SUPER_ADMIN' } }), undefined);
    assert.equal(await run({ role: { name: 'VENDOR_OWNER' } }), undefined);
  });
});
