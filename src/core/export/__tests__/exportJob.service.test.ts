import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ExportJob } from '@database/models/exportJob.model';
import {
  getOwnedExportJob,
  acknowledgeExportJob,
} from '../exportJob.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: OWNER,
    status: 'QUEUED',
    acknowledgedAt: null,
    ...overrides,
  };
}

describe('exportJob.service', () => {
  afterEach(() => mock.restoreAll());

  it('getOwnedExportJob throws NotFoundError for a missing job', async () => {
    mock.method(ExportJob, 'findByPk', async () => null);
    await assert.rejects(() => getOwnedExportJob(JOB_ID, OWNER), NotFoundError);
  });

  it('getOwnedExportJob throws NotFoundError (not ForbiddenError) for a foreign job', async () => {
    mock.method(ExportJob, 'findByPk', async () => jobRow({ ownerId: OTHER }));
    await assert.rejects(() => getOwnedExportJob(JOB_ID, OWNER), NotFoundError);
  });

  it('acknowledgeExportJob no-ops for QUEUED, PROCESSING, and CANCELLED', async () => {
    const update = mock.method(ExportJob, 'update', async () => [0]);
    for (const status of ['QUEUED', 'PROCESSING', 'CANCELLED'] as const) {
      mock.method(ExportJob, 'findByPk', async () => jobRow({ status }));
      await acknowledgeExportJob(JOB_ID, OWNER);
    }
    assert.equal(update.mock.callCount(), 0);
  });

  it('acknowledgeExportJob sets acknowledgedAt for COMPLETED and FAILED', async () => {
    const update = mock.method(ExportJob, 'update', async () => [1]);
    mock.method(ExportJob, 'findByPk', async () => jobRow({ status: 'COMPLETED' }));
    await acknowledgeExportJob(JOB_ID, OWNER);
    mock.method(ExportJob, 'findByPk', async () => jobRow({ status: 'FAILED' }));
    await acknowledgeExportJob(JOB_ID, OWNER);
    assert.equal(update.mock.callCount(), 2);
    const first = update.mock.calls[0]?.arguments[0] as { acknowledgedAt: Date };
    assert.ok(first.acknowledgedAt instanceof Date);
  });

  it('acknowledgeExportJob still enforces ownership', async () => {
    mock.method(ExportJob, 'findByPk', async () => jobRow({ status: 'COMPLETED', ownerId: OTHER }));
    await assert.rejects(() => acknowledgeExportJob(JOB_ID, OWNER), NotFoundError);
  });
});
