import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildS3EntityPrefix, buildS3Key, extensionFromFilename, parseS3Key } from '@core/s3/buildS3Key';
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

describe('buildS3Key entity id guard', () => {
  it('rejects an entity id that could escape its own prefix', () => {
    for (const entityId of ['a/../b', 'vendor-1/kyc', '..', 'id with space', 'a.b']) {
      assert.throws(
        () => buildS3Key(S3_ENTITY_TYPES.PRODUCTS, entityId, S3_PURPOSES.IMAGES, 'x.png'),
        /entityId may only contain/,
        entityId,
      );
      assert.throws(() => buildS3EntityPrefix(S3_ENTITY_TYPES.VENDORS, entityId), /entityId may only contain/);
    }
  });
});

describe('parseS3Key', () => {
  const productId = '11111111-1111-4111-8111-111111111111';

  it('reads back the entity and purpose of a key buildS3Key issued', () => {
    const key = buildS3Key(S3_ENTITY_TYPES.PRODUCTS, productId, S3_PURPOSES.IMAGES, 'a.png');
    assert.deepEqual(parseS3Key(key), {
      entityType: S3_ENTITY_TYPES.PRODUCTS,
      entityId: productId,
      purpose: S3_PURPOSES.IMAGES,
    });
  });

  it('rejects keys it did not issue', () => {
    const key = buildS3Key(S3_ENTITY_TYPES.PRODUCTS, productId, S3_PURPOSES.IMAGES, 'a.png');
    const [env, , , , file] = key.split('/');
    for (const bad of [
      `other-env/products/${productId}/images/${file}`,
      `${env}/products/${productId}/kyc/${file}`,
      `${env}/unknown/${productId}/images/${file}`,
      `${env}/products/../images/${file}`,
      `${env}/products/${productId}/images/../../x.png`,
      `${env}/products/${productId}/images`,
      '',
    ]) {
      assert.equal(parseS3Key(bad), null, bad);
    }
  });
});
