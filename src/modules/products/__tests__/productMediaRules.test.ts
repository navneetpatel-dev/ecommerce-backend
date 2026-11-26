import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MAX_PRODUCT_IMAGES } from '@core/constants/product';
import { ProductImage } from '@database/models/productImage.model';
import { assertCanAddImage, mediaStorage, assertProductMediaUrl, assertProductMediaUrls } from '../productMediaRules';

const status = (e: unknown) => (e as { statusCode?: number }).statusCode;
const tx = {} as never;

describe('product media rules', () => {
  afterEach(() => mock.restoreAll());

  it('a product can carry at most MAX_PRODUCT_IMAGES images: the last slot is fine, one more is refused (422)', async () => {
    mock.method(mediaStorage, 'configured', () => false);
    mock.method(ProductImage, 'count', async () => MAX_PRODUCT_IMAGES - 1);
    await assert.doesNotReject(assertCanAddImage('p1', 'https://x/y.jpg', tx));
    mock.method(ProductImage, 'count', async () => MAX_PRODUCT_IMAGES);
    await assert.rejects(assertCanAddImage('p1', 'https://x/y.jpg', tx), (e) => status(e) === 422 && /at most 10/.test((e as Error).message));
    assert.equal(MAX_PRODUCT_IMAGES, 10);
  });

  it('with storage configured, a link to another site is refused for images, video and size chart', () => {
    mock.method(mediaStorage, 'configured', () => true);
    for (const [purpose, field] of [['images', 'url'], ['video', 'videoUrl'], ['size-chart', 'sizeChartUrl']] as const) {
      assert.throws(() => assertProductMediaUrl('https://evil.example.com/a.jpg', purpose, field), (e) => status(e) === 422, purpose);
      assert.throws(() => assertProductMediaUrl('javascript:alert(1)', purpose, field), (e) => status(e) === 422);
    }
  });

  it('empty values are fine (the media is optional)', () => {
    mock.method(mediaStorage, 'configured', () => true);
    assert.doesNotThrow(() => assertProductMediaUrl(null, 'video', 'videoUrl'));
    assert.doesNotThrow(() => assertProductMediaUrl(undefined, 'size-chart', 'sizeChartUrl'));
    assert.doesNotThrow(() => assertProductMediaUrls({ videoUrl: null, sizeChartUrl: null }));
  });

  it('on update only a changed link is checked: an older product’s existing link can be sent back unchanged', () => {
    mock.method(mediaStorage, 'configured', () => true);
    const legacy = { videoUrl: 'https://old.example.com/v.mp4', sizeChartUrl: 'https://old.example.com/s.png' };
    assert.doesNotThrow(() => assertProductMediaUrls({ ...legacy }, legacy));
    assert.throws(() => assertProductMediaUrls({ ...legacy, videoUrl: 'https://other.example.com/new.mp4' }, legacy), (e) => status(e) === 422);
  });
});

import { PresignBulkSchema } from '@modules/uploads/uploads.dto';

describe('one presign request for product photos', () => {
  const file = { filename: 'a.jpg', contentType: 'image/jpeg', contentLength: 1000 };
  const request = (count: number, over: Record<string, unknown> = {}) => ({
    entityType: 'products',
    entityId: '11111111-1111-4111-8111-111111111111',
    purpose: 'images',
    files: Array.from({ length: count }, () => file),
    ...over,
  });

  it('accepts up to MAX_PRODUCT_IMAGES files and refuses more', () => {
    assert.equal(PresignBulkSchema.safeParse(request(MAX_PRODUCT_IMAGES)).success, true);
    assert.equal(PresignBulkSchema.safeParse(request(MAX_PRODUCT_IMAGES + 1)).success, false);
  });

  it('other uploads keep the general cap of 20', () => {
    assert.equal(PresignBulkSchema.safeParse(request(15, { entityType: 'tickets', purpose: 'attachments' })).success, true);
  });
});
