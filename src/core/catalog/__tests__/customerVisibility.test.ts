import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRODUCT_STATUS, UNAVAILABLE_REASON, VENDOR_STATUS } from '@core/constants/statuses';
import {
  isProductCustomerVisible,
  isVendorSellable,
  resolveItemAvailability,
} from '@core/catalog/customerVisibility';

describe('isVendorSellable', () => {
  it('sells only when approved and every KYC document is verified', () => {
    assert.equal(isVendorSellable({ status: VENDOR_STATUS.APPROVED, kycVerified: true }), true);
    assert.equal(isVendorSellable({ status: VENDOR_STATUS.APPROVED, kycVerified: false }), false);
    assert.equal(isVendorSellable({ status: VENDOR_STATUS.APPROVED }), false);
    assert.equal(isVendorSellable({ status: VENDOR_STATUS.SUSPENDED, kycVerified: true }), false);
    assert.equal(isVendorSellable(null), false);
  });

  it('hides products and blocks checkout for a vendor with unverified documents', () => {
    const vendor = { status: VENDOR_STATUS.APPROVED, kycVerified: false };
    const product = { status: PRODUCT_STATUS.LIVE, Category: { status: 'ACTIVE' } };
    assert.equal(isProductCustomerVisible(product, vendor), false);
    assert.deepEqual(resolveItemAvailability({ product, vendor, stock: 5, quantity: 1 }), {
      isAvailable: false,
      unavailableReason: UNAVAILABLE_REASON.VENDOR_UNAVAILABLE,
    });
    assert.equal(
      resolveItemAvailability({ product, vendor: { ...vendor, kycVerified: true }, stock: 5, quantity: 1 })
        .isAvailable,
      true,
    );
  });
});

describe('resolveItemAvailability stock reasons (B-66)', () => {
  const product = { status: PRODUCT_STATUS.LIVE, Category: { status: 'ACTIVE' } };
  const vendor = { status: VENDOR_STATUS.APPROVED, kycVerified: true };

  it('calls a line LOW_STOCK when some stock is left but less than the quantity', () => {
    assert.deepEqual(resolveItemAvailability({ product, vendor, stock: 58, quantity: 61 }), {
      isAvailable: false,
      unavailableReason: UNAVAILABLE_REASON.LOW_STOCK,
    });
  });

  it('keeps OUT_OF_STOCK for a sold-out variant', () => {
    assert.equal(
      resolveItemAvailability({ product, vendor, stock: 0, quantity: 1 }).unavailableReason,
      UNAVAILABLE_REASON.OUT_OF_STOCK,
    );
  });
});

describe('a product is off sale outside an active category', () => {
  const vendor = { status: VENDOR_STATUS.APPROVED, kycVerified: true };
  const live = { status: PRODUCT_STATUS.LIVE, name: 'Mug', Category: { status: 'ACTIVE' } };

  it('refuses an archived category, a missing one and a seed placeholder', () => {
    assert.equal(isProductCustomerVisible(live, vendor), true);
    for (const product of [
      { ...live, Category: { status: 'ARCHIVED' } },
      { ...live, Category: undefined },
      { ...live, name: 'Seed Mug' },
    ]) {
      assert.equal(isProductCustomerVisible(product, vendor), false);
      assert.equal(
        resolveItemAvailability({ product, vendor, stock: 5, quantity: 1 }).unavailableReason,
        UNAVAILABLE_REASON.PRODUCT_UNPUBLISHED,
      );
    }
  });
});
