import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ListAuditQuerySchema } from '../audit.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';

describe('audit DTO schema', () => {
  it('defaults page/limit and accepts an empty query', () => {
    const parsed = ListAuditQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.ok(parsed.limit > 0);
  });

  it('coerces pagination from query strings and caps the limit', () => {
    const parsed = ListAuditQuerySchema.parse({ page: '3', limit: '10' });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 10);
    assert.equal(ListAuditQuerySchema.safeParse({ limit: '100000' }).success, false);
    assert.equal(ListAuditQuerySchema.safeParse({ page: '0' }).success, false);
  });

  it('requires a uuid for actorId but accepts free-text actor', () => {
    assert.equal(ListAuditQuerySchema.safeParse({ actorId: UUID }).success, true);
    assert.equal(ListAuditQuerySchema.safeParse({ actorId: 'not-a-uuid' }).success, false);
    const parsed = ListAuditQuerySchema.parse({ actor: '  admin@ecommerce.com ' });
    assert.equal(parsed.actor, 'admin@ecommerce.com');
  });

  it('date filters parse to Dates with the to-bound inclusive of the day', () => {
    const parsed = ListAuditQuerySchema.parse({ from: '2026-01-01', to: '2026-01-02' });
    assert.ok(parsed.from instanceof Date);
    assert.ok(parsed.to instanceof Date);
    assert.ok(
      parsed.to!.getTime() >= parsed.from!.getTime(),
      'inclusive to-bound must not precede the from-bound',
    );
  });

  it('rejects entityType that trims to empty', () => {
    assert.equal(ListAuditQuerySchema.safeParse({ entityType: '   ' }).success, false);
  });
});
