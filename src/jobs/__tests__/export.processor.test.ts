import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it, mock, afterEach } from 'node:test';
import { AppError } from '@core/errors';
import { ExportJob } from '@database/models/exportJob.model';
import { logger } from '@core/logger';
import { exportConfig } from '@core/export';
import type { ExportSource } from '@core/export';
import { processExportJob, exportProcessorIo, type ExportJobPayload } from '../export.processor';
import type { Job } from 'bullmq';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeJob(): Job<ExportJobPayload> {
  return {
    id: JOB_ID,
    name: 'run-export',
    data: {
      exportJobId: JOB_ID,
      actor: { id: 'user-1', roleName: 'SUPER_ADMIN', permissions: [] },
    },
    updateProgress: mock.fn(async () => undefined),
  } as unknown as Job<ExportJobPayload>;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    ownerId: 'user-1',
    domain: 'report',
    exportType: 'gmv-sales',
    format: 'csv' as const,
    status: 'QUEUED',
    filters: {},
    ...overrides,
  };
}

async function* oneChunk(): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  yield [{ id: 1 }];
}

function okSource(): ExportSource {
  return {
    title: 'test',
    columns: [{ key: 'id', label: 'ID' }],
    rows: () => oneChunk(),
  };
}

function mockUploadOk() {
  return mock.method(exportProcessorIo, 'uploadObjectStream', async ({ stream }: { stream: Readable }) => {
    stream.resume();
    return 'https://example.test/file';
  });
}

describe('processExportJob', () => {
  afterEach(() => mock.restoreAll());

  it('retries internally and completes without markFailed when the second attempt succeeds', async () => {
    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'updateProgress', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markCompleted = mock.method(exportProcessorIo, 'markCompleted', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mockUploadOk();

    let calls = 0;
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient db blip');
      return okSource();
    });

    await processExportJob(fakeJob());

    assert.equal(calls, 2);
    assert.equal(markCompleted.mock.callCount(), 1);
    assert.equal(markFailed.mock.callCount(), 0);
  });

  it('calls markFailed exactly once with a generic message for a non-AppError after both attempts', async () => {
    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mock.method(exportProcessorIo, 'markCompleted', async () => {
      throw new Error('should not complete');
    });
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => {
      throw new Error('internal detail that should not leak');
    });

    await assert.rejects(() => processExportJob(fakeJob()), /internal detail/);

    assert.equal(markFailed.mock.callCount(), 1);
    assert.match(
      String(markFailed.mock.calls[0]?.arguments[1]),
      /please try again or contact support/,
    );
  });

  it('passes an AppError message through verbatim', async () => {
    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    });

    await assert.rejects(() => processExportJob(fakeJob()));

    assert.equal(markFailed.mock.calls[0]?.arguments[1], 'Report not found');
  });

  it('fails with the stalled message after inactivity, not a generic error', async () => {
    const original = exportConfig.maxInactivityMs;
    (exportConfig as { maxInactivityMs: number }).maxInactivityMs = 40;

    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mockUploadOk();
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => ({
      title: 'hang',
      columns: [{ key: 'id', label: 'ID' }],
      rows: async function* () {
        await new Promise(() => undefined);
        yield [{ id: 1 }];
      },
    }));

    try {
      await assert.rejects(() => processExportJob(fakeJob()));
      assert.match(String(markFailed.mock.calls[0]?.arguments[1]), /stalled with no progress/);
    } finally {
      (exportConfig as { maxInactivityMs: number }).maxInactivityMs = original;
    }
  });

  it('does not stall a steadily-progressing export that runs past maxInactivityMs', async () => {
    const original = exportConfig.maxInactivityMs;
    (exportConfig as { maxInactivityMs: number }).maxInactivityMs = 80;

    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'updateProgress', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markCompleted = mock.method(exportProcessorIo, 'markCompleted', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mockUploadOk();
    const chunk = Array.from({ length: exportConfig.progressUpdateEveryRows }, (_, i) => ({ id: i }));
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => ({
      title: 'slow-but-alive',
      columns: [{ key: 'id', label: 'ID' }],
      rows: async function* () {
        yield chunk;
        await new Promise((r) => setTimeout(r, 50));
        yield chunk;
        await new Promise((r) => setTimeout(r, 50));
        yield chunk;
      },
    }));

    try {
      await processExportJob(fakeJob());
      assert.equal(markCompleted.mock.callCount(), 1);
      assert.equal(markFailed.mock.callCount(), 0);
    } finally {
      (exportConfig as { maxInactivityMs: number }).maxInactivityMs = original;
    }
  });

  it('surfaces the upload error when S3 fails mid-stream, not a generic stream-destroyed message', async () => {
    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    const markFailed = mock.method(exportProcessorIo, 'markFailed', async () => undefined);
    mock.method(exportProcessorIo, 'uploadObjectStream', async ({ stream }: { stream: NodeJS.WritableStream }) => {
      const err = new AppError('UPLOAD_FAILED', 500, 'UPLOAD_FAILED');
      stream.on('error', () => undefined);
      stream.destroy(err);
      throw err;
    });
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => okSource());

    await assert.rejects(() => processExportJob(fakeJob()), /UPLOAD_FAILED/);
    assert.equal(String(markFailed.mock.calls[0]?.arguments[1]), 'UPLOAD_FAILED');
  });

  it('returns immediately for an already-COMPLETED row without uploading', async () => {
    mock.method(ExportJob, 'findByPk', async () => row({ status: 'COMPLETED' }));
    const upload = mock.method(exportProcessorIo, 'uploadObjectStream', async () => {
      throw new Error('should not upload');
    });
    const markCompleted = mock.method(exportProcessorIo, 'markCompleted', async () => undefined);
    const markProcessing = mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    await processExportJob(fakeJob());
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(markCompleted.mock.callCount(), 0);
    assert.equal(markProcessing.mock.callCount(), 0);
  });

  it('still rethrows when markFailed itself throws', async () => {
    mock.method(ExportJob, 'findByPk', async () => row());
    mock.method(exportProcessorIo, 'markProcessing', async () => undefined);
    mock.method(exportProcessorIo, 'sleep', async () => undefined);
    mock.method(exportProcessorIo, 'markFailed', async () => {
      throw new Error('db down at markFailed');
    });
    const errorLog = mock.method(logger, 'error', () => undefined);
    mock.method(exportProcessorIo, 'resolveExportSource', () => async () => {
      throw new Error('original failure');
    });

    await assert.rejects(() => processExportJob(fakeJob()), /original failure/);
    const messages = errorLog.mock.calls.map((c) => c.arguments[0]);
    assert.ok(messages.includes('export_job_mark_failed_write_failed'));
  });
});
