import assert from 'node:assert/strict';
import { describe, it, mock, afterEach, before } from 'node:test';
import { queues } from '@config/queue';
import { ExportJob } from '@database/models/exportJob.model';
import { registerExportDomain, listRegisteredExportDomains } from '@core/export/exportSourceRegistry';
import { startExport } from '../exports.service';
import type { ExportActor } from '@core/export';

const actor: ExportActor = {
  id: 'owner-1',
  vendorId: null,
  roleName: 'SUPER_ADMIN',
  permissions: [],
};

describe('startExport', () => {
  before(() => {
    if (!listRegisteredExportDomains().includes('report')) {
      registerExportDomain('report', async () => {
        throw new Error('resolver unused in startExport tests');
      });
    }
  });

  afterEach(() => mock.restoreAll());

  it('marks the created row failed and rethrows when the queue add fails', async () => {
    mock.method(ExportJob, 'create', async () => ({ id: 'job-1', status: 'QUEUED' }));
    const update = mock.method(ExportJob, 'update', async () => [1]);
    Object.defineProperty(queues, 'exports', {
      configurable: true,
      get: () => ({
        add: async () => {
          throw new Error('Redis unavailable');
        },
      }),
    });

    await assert.rejects(
      () =>
        startExport(actor, {
          domain: 'report',
          exportType: 'gmv-sales',
          format: 'csv',
          filters: {},
        }),
      /Redis unavailable/,
    );
    assert.equal(update.mock.callCount(), 1);
    const [values, options] = update.mock.calls[0]?.arguments as [
      { status: string; errorMessage: string },
      { where: { id: string } },
    ];
    assert.equal(values.status, 'FAILED');
    assert.match(String(values.errorMessage), /Could not queue the export/);
    assert.equal(options.where.id, 'job-1');
  });
});
