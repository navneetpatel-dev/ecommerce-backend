import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { errorHandlerMiddleware } from '../errorHandler.middleware';

function run(err: Error) {
  const out: { status?: number; body?: { error?: { code?: string } } } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body as typeof out.body;
      return this;
    },
    setHeader() {},
  } as unknown as Response;
  errorHandlerMiddleware(err, { path: '/x', method: 'GET' } as Request, res, () => undefined);
  return out;
}

describe('malformed ids (B-34)', () => {
  it('answers 400, not 500, when Postgres rejects a non-UUID id', () => {
    const dbError = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), {
      name: 'SequelizeDatabaseError',
      parent: { code: '22P02' },
    });
    const out = run(dbError);
    assert.equal(out.status, 400);
    assert.equal(out.body?.error?.code, 'INVALID_ID');
  });

  it('keeps other unexpected errors as 500', () => {
    assert.equal(run(new Error('boom')).status, 500);
  });
});
