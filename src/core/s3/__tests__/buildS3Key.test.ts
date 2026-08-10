import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildS3EntityPrefix, buildS3Key, extensionFromFilename } from '@core/s3/buildS3Key';
import { S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3/constants';

describe('buildS3Key', () => {
  it('uses env/entity/id/purpose/uuid.ext and ignores original basename', () => {
    const key = buildS3Key(
      S3_ENTITY_TYPES.PRODUCTS,
      '11111111-1111-4111-8111-111111111111',
      S3_PURPOSES.IMAGES,
      '../../evil name.JPG',
    );
    const parts = key.split('/');
    assert.equal(parts.length, 5);
    assert.equal(parts[1], 'products');
    assert.equal(parts[2], '11111111-1111-4111-8111-111111111111');
    assert.equal(parts[3], 'images');
    assert.match(parts[4]!, /^[0-9a-f-]{36}\.jpg$/i);
    assert.ok(!key.toLowerCase().includes('evil'));
  });

  it('builds cascade prefix for an entity', () => {
    const prefix = buildS3EntityPrefix(S3_ENTITY_TYPES.VENDORS, 'vendor-1');
    assert.match(prefix, /\/vendors\/vendor-1\/$/);
  });

  it('sanitizes extensions', () => {
    assert.equal(extensionFromFilename('a.PNG'), 'png');
    assert.equal(extensionFromFilename('noext'), 'bin');
  });
});
