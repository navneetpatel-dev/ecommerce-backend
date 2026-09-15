import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, mock, before, after, afterEach } from 'node:test';
import { bindExportQueueEvents, exportProgressBridgeIo } from '../exportProgressBridge';

const fakeExports = new EventEmitter();

describe('exportProgressBridge', () => {
  const emit = mock.fn((_jobId: string, _event: string, _payload: Record<string, unknown>) => undefined);
  const warn = mock.fn();

  before(() => {
    mock.method(exportProgressBridgeIo, 'emitExportJobEvent', emit);
    mock.method(exportProgressBridgeIo, 'warn', warn);
    bindExportQueueEvents(fakeExports);
  });

  after(() => mock.restoreAll());

  afterEach(() => {
    emit.mock.resetCalls();
    warn.mock.resetCalls();
  });

  it('relays a well-formed progress payload', () => {
    fakeExports.emit('progress', { jobId: 'job-1', data: { rowsProcessed: 10, total: 100 } });
    assert.equal(emit.mock.callCount(), 1);
    assert.deepEqual(emit.mock.calls[0]?.arguments, [
      'job-1',
      'export:progress',
      { jobId: 'job-1', rowsProcessed: 10, total: 100 },
    ]);
  });

  it('drops malformed progress payloads and logs instead of emitting', () => {
    const bad = [null, 'nope', [1, 2], { rowsProcessed: '10' }];
    for (const data of bad) {
      fakeExports.emit('progress', { jobId: 'job-1', data });
    }
    assert.equal(emit.mock.callCount(), 0);
    assert.equal(warn.mock.callCount(), bad.length);
    for (const call of warn.mock.calls) {
      assert.equal(call.arguments[0], 'export_progress_event_malformed');
    }
  });

  it('passes completed and failed events through unconditionally', () => {
    fakeExports.emit('completed', { jobId: 'job-1' });
    fakeExports.emit('failed', { jobId: 'job-1', failedReason: 'boom' });
    assert.equal(emit.mock.callCount(), 2);
    assert.equal(emit.mock.calls[0]?.arguments[1], 'export:completed');
    assert.deepEqual(emit.mock.calls[1]?.arguments, [
      'job-1',
      'export:failed',
      { jobId: 'job-1', message: 'boom' },
    ]);
  });
});
