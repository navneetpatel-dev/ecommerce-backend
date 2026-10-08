import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateStockAlertSchema,
  DeleteStockAlertQuerySchema,
  UpdateStockSchema,
} from '../inventory.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';

describe('inventory DTO schemas', () => {
  it('stock updates require a non-negative integer (no coercion from strings)', () => {
    assert.equal(UpdateStockSchema.safeParse({ stock: 0 }).success, true);
    assert.equal(UpdateStockSchema.safeParse({ stock: 42 }).success, true);
    assert.equal(UpdateStockSchema.safeParse({ stock: -1 }).success, false);
    assert.equal(UpdateStockSchema.safeParse({ stock: 1.5 }).success, false);
    assert.equal(UpdateStockSchema.safeParse({ stock: '5' }).success, false);
  });

  it('stock alert creation requires a uuid variant and a valid optional email', () => {
    assert.equal(CreateStockAlertSchema.safeParse({ variantId: UUID }).success, true);
    assert.equal(
      CreateStockAlertSchema.safeParse({ variantId: UUID, guestEmail: 'a@b.co' }).success,
      true,
    );
    assert.equal(
      CreateStockAlertSchema.safeParse({ variantId: UUID, guestEmail: 'nope' }).success,
      false,
    );
    assert.equal(CreateStockAlertSchema.safeParse({ variantId: 'nope' }).success, false);
  });

  it('delete query accepts an optional guest email only', () => {
    assert.equal(DeleteStockAlertQuerySchema.safeParse({}).success, true);
    assert.equal(
      DeleteStockAlertQuerySchema.safeParse({ guestEmail: 'a@b.co' }).success,
      true,
    );
    assert.equal(
      DeleteStockAlertQuerySchema.safeParse({ guestEmail: 'nope' }).success,
      false,
    );
  });
});
