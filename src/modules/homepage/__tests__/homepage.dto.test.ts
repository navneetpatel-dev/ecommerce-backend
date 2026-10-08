import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROMO_BANNER_LINK_TYPE } from '@core/constants/statuses';
import { CreatePromoBannerSchema, UpdatePromoBannerSchema } from '../homepage.dto';

const UUID = '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d';
const IMAGE = 'https://cdn.example.com/banner.png';

describe('homepage promo banner DTO schemas', () => {
  it('accepts a product banner with a valid target id', () => {
    const parsed = CreatePromoBannerSchema.safeParse({
      title: 'Mega Sale',
      imageUrl: IMAGE,
      linkType: PROMO_BANNER_LINK_TYPE.PRODUCT,
      linkTargetId: UUID,
    });
    assert.equal(parsed.success, true);
  });

  it('requires linkTargetId for PRODUCT/CATEGORY/VENDOR banners', () => {
    const parsed = CreatePromoBannerSchema.safeParse({
      title: 'Mega Sale',
      imageUrl: IMAGE,
      linkType: PROMO_BANNER_LINK_TYPE.PRODUCT,
    });
    assert.equal(parsed.success, false);
  });

  it('requires linkUrl for URL banners', () => {
    const missing = CreatePromoBannerSchema.safeParse({
      title: 'Mega Sale',
      imageUrl: IMAGE,
      linkType: PROMO_BANNER_LINK_TYPE.URL,
    });
    assert.equal(missing.success, false);

    const present = CreatePromoBannerSchema.safeParse({
      title: 'Mega Sale',
      imageUrl: IMAGE,
      linkType: PROMO_BANNER_LINK_TYPE.URL,
      linkUrl: 'https://example.com/landing',
    });
    assert.equal(present.success, true);
  });

  it('enforces title and imageUrl shape', () => {
    assert.equal(
      CreatePromoBannerSchema.safeParse({
        title: 'a'.repeat(201),
        imageUrl: IMAGE,
        linkType: PROMO_BANNER_LINK_TYPE.URL,
        linkUrl: 'https://example.com',
      }).success,
      false,
    );
    assert.equal(
      CreatePromoBannerSchema.safeParse({
        title: 'Ok',
        imageUrl: 'nope',
        linkType: PROMO_BANNER_LINK_TYPE.URL,
        linkUrl: 'https://example.com',
      }).success,
      false,
    );
  });

  it('update schema stays partial but still enforces link rules when linkType is set', () => {
    assert.equal(UpdatePromoBannerSchema.safeParse({ title: 'New' }).success, true);
    assert.equal(
      UpdatePromoBannerSchema.safeParse({ linkType: PROMO_BANNER_LINK_TYPE.URL }).success,
      false,
    );
  });
});
