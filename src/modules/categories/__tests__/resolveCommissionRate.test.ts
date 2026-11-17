import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { categoriesService } from '../categories.service';

describe('categoriesService.resolveCommissionRate', () => {
  afterEach(() => mock.restoreAll());

  const withAncestors = (nodes: Array<{ commissionRate: number | null }>) =>
    mock.method(categoriesService as never, 'walkCategoryAncestors', async () => nodes as never);

  it('follows the platform default when the vendor has no rate of their own', async () => {
    withAncestors([{ commissionRate: null }]);
    assert.equal(await categoriesService.resolveCommissionRate('cat', null, 15), 15);
    assert.equal(await categoriesService.resolveCommissionRate('cat', undefined, 15), 15);
  });

  it("uses the vendor's own rate over the platform default", async () => {
    withAncestors([{ commissionRate: null }]);
    assert.equal(await categoriesService.resolveCommissionRate('cat', 12, 15), 12);
  });

  it("lets a category's rate win over both", async () => {
    withAncestors([{ commissionRate: 8 }]);
    assert.equal(await categoriesService.resolveCommissionRate('cat', 12, 15), 8);
  });

  it('keeps a deliberate 0% vendor rate instead of falling back', async () => {
    withAncestors([{ commissionRate: null }]);
    assert.equal(await categoriesService.resolveCommissionRate('cat', 0, 15), 0);
  });
});
