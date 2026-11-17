import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shortLinksService } from '../shortLinks.service';

describe('ShortLinksService', () => {
  it('creates and resolves a short link for a product', async () => {
    const created = await shortLinksService.createOrGetShortLink({
      targetUrl: '/products/test-product-share',
      resourceType: 'PRODUCT',
      metadata: {
        name: 'Test Product Share',
        price: 999,
        imageUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794',
        description: 'Test product for share link module',
      },
    });

    assert.ok(created.code);
    assert.equal(created.code.length, 7);
    assert.equal(created.targetUrl, '/products/test-product-share');
    assert.ok(created.shortUrl.includes(`/s/${created.code}`));
    assert.equal(created.metadata?.name, 'Test Product Share');

    // Resolving the code returns the created short link
    const resolved = await shortLinksService.resolveShortLink(created.code);
    assert.equal(resolved.code, created.code);
    assert.equal(resolved.targetUrl, '/products/test-product-share');
    assert.equal(resolved.metadata?.name, 'Test Product Share');
  });

  it('is idempotent when requesting the same targetUrl', async () => {
    const first = await shortLinksService.createOrGetShortLink({
      targetUrl: '/products/unique-idempotent-test',
      metadata: { name: 'Unique Product' },
    });

    const second = await shortLinksService.createOrGetShortLink({
      targetUrl: '/products/unique-idempotent-test',
    });

    assert.equal(first.code, second.code);
    assert.equal(first.shortUrl, second.shortUrl);
  });
});
