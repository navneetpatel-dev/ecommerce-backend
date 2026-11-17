import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisputeReturnSchema, ResolveReturnDisputeSchema, ListReturnsQuerySchema } from '../returns.dto';

describe('returns DTO schemas', () => {
  it('validates DisputeReturnSchema', () => {
    const valid = {
      reason: 'Damaged item received',
      description: 'Customer sent back an empty box with no phone inside.',
      evidenceUrls: ['https://example.com/evidence1.jpg'],
    };
    assert.equal(DisputeReturnSchema.safeParse(valid).success, true);

    // reason too short
    assert.equal(DisputeReturnSchema.safeParse({ ...valid, reason: 'ab' }).success, false);

    // description too short
    assert.equal(DisputeReturnSchema.safeParse({ ...valid, description: 'bad' }).success, false);

    // invalid URL
    assert.equal(
      DisputeReturnSchema.safeParse({ ...valid, evidenceUrls: ['not-a-url'] }).success,
      false,
    );
  });

  it('validates ResolveReturnDisputeSchema', () => {
    assert.equal(
      ResolveReturnDisputeSchema.safeParse({
        resolution: 'UPHELD',
        notes: 'Merchant provided unboxing video proof; customer return rejected.',
      }).success,
      true,
    );

    assert.equal(
      ResolveReturnDisputeSchema.safeParse({
        resolution: 'REJECTED',
        notes: 'Carrier confirmed damage occurred during initial delivery.',
      }).success,
      true,
    );

    assert.equal(
      ResolveReturnDisputeSchema.safeParse({
        resolution: 'INVALID_RESOLUTION',
        notes: 'Some notes',
      }).success,
      false,
    );
  });

  it('validates ListReturnsQuerySchema', () => {
    const parsed = ListReturnsQuerySchema.parse({
      page: '2',
      limit: '50',
      status: 'APPROVED',
      search: 'DEFECT',
    });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.status, 'APPROVED');
    assert.equal(parsed.search, 'DEFECT');
  });
});
