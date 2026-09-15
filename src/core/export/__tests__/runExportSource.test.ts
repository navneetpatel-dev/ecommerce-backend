import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { ValidationError } from '@core/errors/ValidationError';
import { runExportSource } from '../runExportSource';
import { exportConfig } from '../exportConfig';
import type { ExportSource } from '../exportTypes';

async function* chunksOf(rows: Record<string, unknown>[][]): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  for (const chunk of rows) yield chunk;
}

function source(rows: Record<string, unknown>[][], estimateTotal?: number | null): ExportSource {
  return {
    title: 'test',
    columns: [{ key: 'id', label: 'ID' }],
    estimateTotal: estimateTotal === undefined ? undefined : async () => estimateTotal,
    rows: () => chunksOf(rows),
  };
}

describe('runExportSource', () => {
  it('returns the streamed row count', async () => {
    const sink = new PassThrough();
    sink.resume();
    const result = await runExportSource(
      source([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]),
      'csv',
      sink,
    );
    assert.equal(result.rowCount, 3);
    assert.ok(result.byteSize > 0);
    assert.match(result.contentType, /csv/);
  });

  it('fires onProgress at the configured row interval', async () => {
    const sink = new PassThrough();
    sink.resume();
    const ticks: Array<[number, number | null]> = [];
    const chunk = Array.from({ length: exportConfig.progressUpdateEveryRows }, (_, i) => ({ id: i }));
    await runExportSource(source([chunk, [{ id: 'last' }]], 1000), 'csv', sink, async (n, total) => {
      ticks.push([n, total]);
    });
    assert.ok(ticks.length >= 1);
    assert.equal(ticks[0]?.[0], exportConfig.progressUpdateEveryRows);
    assert.equal(ticks[0]?.[1], 1000);
    assert.equal(ticks[ticks.length - 1]?.[0], exportConfig.progressUpdateEveryRows + 1);
  });

  it('throws ValidationError when maxRows is exceeded', async () => {
    const sink = new PassThrough();
    sink.resume();
    const original = exportConfig.maxRows;
    (exportConfig as { maxRows: number }).maxRows = 2;
    try {
      await assert.rejects(
        () => runExportSource(source([[{ id: 1 }, { id: 2 }, { id: 3 }]]), 'csv', sink),
        (err: unknown) => err instanceof ValidationError && /maximum row limit/.test(err.message),
      );
    } finally {
      (exportConfig as { maxRows: number }).maxRows = original;
    }
  });

  it('throws on the next chunk when the abort signal is already aborted', async () => {
    const sink = new PassThrough();
    sink.resume();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => runExportSource(source([[{ id: 1 }]]), 'csv', sink, undefined, controller.signal),
      /Export aborted/,
    );
  });
});
