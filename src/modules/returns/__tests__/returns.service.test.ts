import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { settingsService } from '@modules/settings/settings.service';
import { returnsService } from '../returns.service';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ROLES } from '@core/constants/statuses';

describe('ReturnsService vendor access', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubSettings() {
    mock.method(settingsService, 'getPlatformSettings', async () => ({
      refundSlaBusinessDays: 5,
    }));
  }

  function stubReturn(vendorId: string) {
    const plain = {
      id: 'rr-1',
      userId: 'customer-1',
      subOrder: { id: 'sub-1', vendorId },
      photoUrls: [],
    };
    mock.method(ReturnRequest, 'findByPk', async () => ({
      ...plain,
      get: () => plain,
    }) as unknown as ReturnRequest);
  }

  it('allows a vendor to read a return on their own suborder', async () => {
    stubSettings();
    stubReturn('vendor-1');

    const result = await returnsService.getById('rr-1', {
      id: 'vendor-user-1',
      roleId: 'role-vendor',
      role: { name: ROLES.VENDOR_OWNER },
      vendorId: 'vendor-1',
    });
    assert.equal(result.id, 'rr-1');
  });

  it("rejects a vendor reading another vendor's return", async () => {
    stubSettings();
    stubReturn('vendor-other');
    mock.method(sequelize, 'query', async () => []);

    await assert.rejects(
      () =>
        returnsService.getById('rr-1', {
          id: 'vendor-user-1',
          roleId: 'role-vendor',
          role: { name: ROLES.VENDOR_OWNER },
          vendorId: 'vendor-1',
        }),
      (err: unknown) => err instanceof ForbiddenError,
    );
  });

  it('listForVendor scopes the SubOrder join to vendorId', async () => {
    stubSettings();
    let captured: { include?: Array<{ as?: string; where?: { vendorId?: string }; required?: boolean }> } | null =
      null;
    mock.method(ReturnRequest, 'findAndCountAll', async (options: typeof captured) => {
      captured = options;
      return { rows: [], count: 0 };
    });

    await returnsService.listForVendor('vendor-1', { page: 1, limit: 20 });
    const subInclude = captured?.include?.find((inc) => inc.as === 'subOrder');
    assert.ok(subInclude);
    assert.equal(subInclude.required, true);
    assert.equal(subInclude.where?.vendorId, 'vendor-1');
  });
});
