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
    const product = { status: PRODUCT_STATUS.LIVE };
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
