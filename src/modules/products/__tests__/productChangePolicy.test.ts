import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPricingChangeAllowed,
  decidePricingChange,
  isOnBehalf,
  isUnpublishedPlatformListing,
  type ProductActor,
  type ProductFacts,
} from '../productChangePolicy';

const actor = (over: Partial<ProductActor>): ProductActor => ({
  id: 'u1',
  vendorId: null,
  canManage: false,
  canPrice: false,
  ...over,
});
const owner = actor({ vendorId: 'v1' });
const otherVendor = actor({ vendorId: 'v2' });
/** A platform product admin without product.pricing. */
const productAdmin = actor({ canManage: true });
const superAdmin = actor({ canManage: true, canPrice: true });

const product = (over: Partial<ProductFacts> = {}): ProductFacts => ({ vendorId: 'v1', status: 'LIVE', listedByPlatform: false, ...over });
const draftByPlatform = product({ status: 'DRAFT', listedByPlatform: true });
const rejectedByPlatform = product({ status: 'REJECTED', listedByPlatform: true });
const reasonText = 'Vendor asked us to correct the price';
const statusOf = (e: unknown) => (e as { statusCode?: number }).statusCode;

describe('who may change a price, tax code, COD or variant', () => {
  it('the vendor may, with no reason, on their own products', () => {
    for (const p of [product(), draftByPlatform]) assert.deepEqual(decidePricingChange(owner, p), { allowed: true, requiresReason: false });
  });

  it('another vendor may not', () => {
    assert.deepEqual(decidePricingChange(otherVendor, product()), { allowed: false, reason: 'PRICING_RESTRICTED' });
  });

  it('the product admin may price a platform-listed product that is not published yet, freely', () => {
    for (const p of [draftByPlatform, rejectedByPlatform]) {
      assert.deepEqual(decidePricingChange(productAdmin, p), { allowed: true, requiresReason: false });
    }
  });

  it('the product admin may not price a live product, a pending one, or a vendor-made draft', () => {
    for (const p of [product(), product({ status: 'PENDING_APPROVAL', listedByPlatform: true }), product({ status: 'DRAFT' })]) {
      assert.deepEqual(decidePricingChange(productAdmin, p), { allowed: false, reason: 'PRICING_RESTRICTED' }, JSON.stringify(p));
    }
  });

  it('a platform-listed product that went live is no longer freely priced', () => {
    assert.deepEqual(decidePricingChange(productAdmin, product({ listedByPlatform: true })), { allowed: false, reason: 'PRICING_RESTRICTED' });
  });

  it('product.pricing (Super Admin) may, but must give a reason', () => {
    assert.deepEqual(decidePricingChange(superAdmin, product()), { allowed: true, requiresReason: true });
  });

  it('the platform’s own products (no vendor) are its catalog: product admins price them freely', () => {
    assert.deepEqual(decidePricingChange(productAdmin, product({ vendorId: null })), { allowed: true, requiresReason: false });
  });

  it('someone without any product power may not', () => {
    assert.equal(decidePricingChange(actor({}), product()).allowed, false);
    assert.equal(decidePricingChange(actor({ canPrice: true }), product()).allowed, false, 'product.pricing alone is not enough');
  });
});

describe('assertPricingChangeAllowed', () => {
  it("refuses with 403 for another vendor's product", () => {
    assert.throws(() => assertPricingChangeAllowed(otherVendor, product(), undefined), (e) => statusOf(e) === 403);
  });

  it('refuses with 403 for a product admin on a live product', () => {
    assert.throws(() => assertPricingChangeAllowed(productAdmin, product(), reasonText), (e) => statusOf(e) === 403);
  });

  it('requires a 10 to 500 character reason from Super Admin on a live product (422)', () => {
    for (const bad of [undefined, '', '   ', 'too short', 'x'.repeat(501)]) {
      assert.throws(() => assertPricingChangeAllowed(superAdmin, product(), bad), (e) => statusOf(e) === 422, String(bad));
    }
    assert.equal(assertPricingChangeAllowed(superAdmin, product(), `  ${reasonText}  `), reasonText, 'trimmed');
  });

  it('needs no reason where none is required, but keeps one that was given', () => {
    assert.equal(assertPricingChangeAllowed(owner, product(), undefined), null);
    assert.equal(assertPricingChangeAllowed(productAdmin, draftByPlatform, undefined), null);
    assert.equal(assertPricingChangeAllowed(owner, product(), reasonText), reasonText);
  });
});

describe('what counts as acting on a vendor’s behalf', () => {
  it('a platform admin on a vendor’s product: yes', () => {
    assert.equal(isOnBehalf(productAdmin, product()), true);
    assert.equal(isOnBehalf(superAdmin, draftByPlatform), true);
  });

  it('the vendor’s own people: no; the platform’s own products: no', () => {
    assert.equal(isOnBehalf(owner, product()), false);
    assert.equal(isOnBehalf(productAdmin, product({ vendorId: null })), false);
  });

  it('only a draft or rejected platform listing is unpublished', () => {
    assert.equal(isUnpublishedPlatformListing(draftByPlatform), true);
    assert.equal(isUnpublishedPlatformListing(rejectedByPlatform), true);
    assert.equal(isUnpublishedPlatformListing(product({ status: 'DRAFT' })), false);
    for (const status of ['PENDING_APPROVAL', 'LIVE', 'ARCHIVED']) {
      assert.equal(isUnpublishedPlatformListing(product({ status, listedByPlatform: true })), false, status);
    }
  });
});
