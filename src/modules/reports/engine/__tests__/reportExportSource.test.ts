import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ROLES } from '@core/constants/statuses';
import { resolveReportExportSource } from '../reportExportSource';
import type { ExportActor } from '@core/export';

const admin: ExportActor = {
  id: 'admin-1',
  vendorId: null,
  roleName: ROLES.SUPER_ADMIN,
  permissions: [],
};

describe('resolveReportExportSource', () => {
  afterEach(() => mock.restoreAll());

  it('throws NotFoundError for an unknown report type', async () => {
    await assert.rejects(
      () => resolveReportExportSource(admin, 'does-not-exist', { from: '2025-01-01', to: '2025-01-31' }),
      NotFoundError,
    );
  });

  it('throws ValidationError for an unparseable date range', async () => {
    await assert.rejects(
      () => resolveReportExportSource(admin, 'gmv-sales', { from: 'not-a-date', to: 'also-bad' }),
      (err: unknown) => err instanceof ValidationError && err.message === 'Invalid date range',
    );
  });

  it('forbids a customer from vendor report types', async () => {
    const customer: ExportActor = { id: 'customer-1', vendorId: null, roleName: ROLES.CUSTOMER, permissions: [] };
    await assert.rejects(
      () =>
        resolveReportExportSource(customer, 'vendor-sales', {
          from: '2025-01-01',
          to: '2025-12-31',
        }),
      (err: unknown) =>
        err instanceof ForbiddenError && err.message === ERROR_MESSAGES.REPORT_FORBIDDEN,
    );
  });
});
