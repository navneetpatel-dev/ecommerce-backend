import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CreateStockAlertSchema,
  CancelStockAlertSchema,
  UpdateStockSchema,
} from '../inventory.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';

describe('inventory DTO schemas', () => {
  it('stock updates require a non-negative integer (no coercion from strings)', () => {
    const edit = (stock: unknown) => UpdateStockSchema.safeParse({ stock, expectedStock: 3 }).success;
    assert.equal(edit(0), true);
    assert.equal(edit(42), true);
    assert.equal(edit(-1), false);
    assert.equal(edit(1.5), false);
    assert.equal(edit('5'), false);
    // Without the figure the editor showed, an edit could undo orders placed meanwhile.
    assert.equal(UpdateStockSchema.safeParse({ stock: 4 }).success, false);
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

  it('cancelling by email link needs the token', () => {
    assert.equal(CancelStockAlertSchema.safeParse({ token: 'abc' }).success, true);
    assert.equal(CancelStockAlertSchema.safeParse({}).success, false);
  });
});
