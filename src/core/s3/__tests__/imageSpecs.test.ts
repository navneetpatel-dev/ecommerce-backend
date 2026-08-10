import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertValidUploadContentType,
  assertValidUploadSize,
  getImageUploadSpec,
} from '@core/s3/imageSpecs';
import { S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3/constants';
import { ValidationError } from '@core/errors/ValidationError';

describe('imageSpecs', () => {
  it('returns spec for product images', () => {
    const spec = getImageUploadSpec(S3_ENTITY_TYPES.PRODUCTS, S3_PURPOSES.IMAGES);
    assert.equal(spec?.aspectRatio, 1);
    assert.equal(spec?.outputWidth, 1200);
  });

  it('rejects invalid content type on presign', () => {
    assert.throws(
      () =>
        assertValidUploadContentType(
          S3_ENTITY_TYPES.PRODUCTS,
          S3_PURPOSES.IMAGES,
          'application/pdf',
        ),
      ValidationError,
    );
  });

  it('allows webp for category images', () => {
    assert.doesNotThrow(() =>
      assertValidUploadContentType(
        S3_ENTITY_TYPES.CATEGORIES,
        S3_PURPOSES.IMAGE,
        'image/webp',
      ),
    );
  });

  it('rejects oversize uploads for avatars', () => {
    assert.throws(
      () =>
        assertValidUploadSize(S3_ENTITY_TYPES.USERS, S3_PURPOSES.AVATAR, 2 * 1024 * 1024),
      ValidationError,
    );
  });

  it('rejects empty uploads', () => {
    assert.throws(
      () => assertValidUploadSize(S3_ENTITY_TYPES.CATEGORIES, S3_PURPOSES.IMAGE, 0),
      ValidationError,
    );
  });
});
