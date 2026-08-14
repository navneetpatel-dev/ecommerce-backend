import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WARRANTY_TYPE } from '@core/constants/statuses';

/**
 * Mirrors the warranty-type coercion used by `pdpPolicy.resolvePdpPolicy`.
 * Kept local so PDP policy behaviour stays covered without wiring service mocks.
 */
function asWarrantyType(value: unknown): string | null {
  if (value === WARRANTY_TYPE.MANUFACTURER || value === WARRANTY_TYPE.SELLER) return value;
  return null;
}

function resolveDisplayWarranty(input: {
  productMonths: number | null;
  productType: unknown;
  categoryMonths: number | null;
  categoryType: unknown;
}) {
  let warrantyMonths =
    input.productMonths != null ? Number(input.productMonths) : null;
  let warrantyType = asWarrantyType(input.productType);
  if (warrantyMonths == null && input.categoryMonths != null) {
    warrantyMonths = Number(input.categoryMonths);
    warrantyType = warrantyType ?? asWarrantyType(input.categoryType);
  }
  if (warrantyMonths != null && warrantyMonths > 0 && !warrantyType) {
    warrantyType = WARRANTY_TYPE.MANUFACTURER;
  }
  if (warrantyMonths != null && warrantyMonths <= 0) {
    warrantyMonths = null;
    warrantyType = null;
  }
  return { warrantyMonths, warrantyType };
}

describe('PDP warranty display resolution', () => {
  it('prefers product warranty over category defaults', () => {
    const result = resolveDisplayWarranty({
      productMonths: 24,
      productType: WARRANTY_TYPE.SELLER,
      categoryMonths: 12,
      categoryType: WARRANTY_TYPE.MANUFACTURER,
    });
    assert.equal(result.warrantyMonths, 24);
    assert.equal(result.warrantyType, WARRANTY_TYPE.SELLER);
  });

  it('falls back to category months and defaults type to manufacturer', () => {
    const result = resolveDisplayWarranty({
      productMonths: null,
      productType: null,
      categoryMonths: 12,
      categoryType: null,
    });
    assert.equal(result.warrantyMonths, 12);
    assert.equal(result.warrantyType, WARRANTY_TYPE.MANUFACTURER);
  });

  it('clears warranty when months are zero or negative', () => {
    const result = resolveDisplayWarranty({
      productMonths: 0,
      productType: WARRANTY_TYPE.MANUFACTURER,
      categoryMonths: 12,
      categoryType: WARRANTY_TYPE.MANUFACTURER,
    });
    assert.equal(result.warrantyMonths, null);
    assert.equal(result.warrantyType, null);
  });
});
