import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Product } from '@database/models';
import { ShortLink } from '@database/models/shortLink.model';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { CreateShortLinkSchema } from '../shortLinks.dto';
import { safeSitePath, shortLinksService } from '../shortLinks.service';

/** Everything a browser could read as leaving the site, or as breaking out of an inline script. */
const OFF_SITE = [
  '//evil.com',
  '//evil.com/path',
  '///evil.com',
  '/\\evil.com',
  '\\\\evil.com',
  '/\\/evil.com',
  'https://evil.com//evil.com',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'evil.com',
  'ftp://evil.com/x',
  '/\t/evil.com',
  '/\n/evil.com',
  '/\r/evil.com',
  '',
  '   ',
  'x'.repeat(5000),
];

describe('safeSitePath', () => {
  it('collapses every off-site or non-path target to "/"', () => {
    for (const input of OFF_SITE) {
      assert.equal(safeSitePath(input), '/', `expected "/" for ${JSON.stringify(input.slice(0, 40))}`);
    }
    for (const input of [undefined, null, 5, {}, [], true]) {
      assert.equal(safeSitePath(input), '/');
    }
  });

  it('keeps ordinary same-site paths and queries', () => {
    assert.equal(safeSitePath('/'), '/');
    assert.equal(safeSitePath('/products/blue-shirt'), '/products/blue-shirt');
    assert.equal(safeSitePath('/category/men/shirts?sort=price&page=2'), '/category/men/shirts?sort=price&page=2');
    assert.equal(safeSitePath('  /products/x  '), '/products/x');
  });

  it('keeps only the path and query of an absolute URL, whatever its host', () => {
    assert.equal(safeSitePath('https://shop.example.com/products/x?y=1#frag'), '/products/x?y=1');
    assert.equal(safeSitePath('http://evil.com/products/x'), '/products/x');
  });

  it('regression: markup that would break out of an inline <script> is percent-encoded', () => {
    for (const input of [
      '/</script><script>alert(1)</script>',
      '/"><img src=x onerror=alert(1)>',
      "/products/x'+alert(1)+'",
      '/?q=</script><svg onload=alert(1)>',
      '/a b',
    ]) {
      const out = safeSitePath(input);
      assert.ok(out.startsWith('/') && !out.startsWith('//'), `must stay a path: ${out}`);
      assert.doesNotMatch(out, /[<>"\s]/, `unsafe characters survived in ${out}`);
    }
    assert.equal(
      safeSitePath('/</script><script>alert(1)</script>'),
      '/%3C/script%3E%3Cscript%3Ealert(1)%3C/script%3E',
    );
  });

  it('is idempotent', () => {
    for (const input of ['/a b', '/</script>', '/x?q="1"', '//evil.com', '/ok']) {
      const once = safeSitePath(input);
      assert.equal(safeSitePath(once), once);
    }
  });
});

describe('CreateShortLinkSchema', () => {
  it('accepts a normal request and strips unknown keys, including client "metadata"', () => {
    const parsed = CreateShortLinkSchema.parse({
      targetUrl: '/products/x',
      resourceType: 'PRODUCT',
      resourceId: '3f2b6c1e-8d0a-4e7b-9c55-2a6f1d9b7e10',
      metadata: { name: 'Free iPhone, log in at evil.com', price: 1 },
    });
    assert.equal('metadata' in parsed, false);
    assert.equal(parsed.targetUrl, '/products/x');
  });

  it('rejects wrong types, resource types, ids and oversized targets', () => {
    for (const bad of [
      { targetUrl: 5 },
      { targetUrl: 'x'.repeat(2049) },
      { resourceType: 'VENDOR' },
      { resourceId: 'not-a-uuid' },
      { resourceId: 12 },
    ]) {
      assert.equal(CreateShortLinkSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
    }
  });
});

describe('ShortLinksService (database)', () => {
  const created: string[] = [];
  const track = async <T extends { code: string }>(p: Promise<T>) => {
    const link = await p;
    created.push(link.code);
    return link;
  };
  after(async () => {
    if (created.length) await ShortLink.destroy({ where: { code: created } });
  });

  it('regression: an off-site target is never stored or returned', async () => {
    for (const evil of ['//evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      const link = await track(shortLinksService.createOrGetShortLink({ targetUrl: evil }));
      assert.equal(link.targetUrl, '/');
      assert.equal((await shortLinksService.resolveShortLink(link.code)).targetUrl, '/');
      const stored = await ShortLink.findOne({ where: { code: link.code } });
      assert.equal(stored?.targetUrl, '/');
    }
  });

  it('regression: script-breaking markup in a target is stored percent-encoded', async () => {
    const link = await track(
      shortLinksService.createOrGetShortLink({ targetUrl: '/x</script><script>alert(1)</script>' }),
    );
    assert.doesNotMatch(link.targetUrl, /[<>]/);
    assert.doesNotMatch((await shortLinksService.resolveShortLink(link.code)).targetUrl, /[<>]/);
  });

  it('regression: caller-supplied preview text is ignored', async () => {
    const link = await track(
      shortLinksService.createOrGetShortLink({
        targetUrl: '/products/no-such-product-security-test',
        metadata: { name: 'URGENT: verify your account', price: 1, imageUrl: 'https://evil.example/x.png' },
      }),
    );
    assert.equal(link.metadata, null);
    assert.equal((await shortLinksService.resolveShortLink(link.code)).metadata, null);
  });

  it('regression: a legacy row holding an off-site target and fake preview is neutralised on read', async () => {
    const code = `legacy${Date.now().toString(36)}`.slice(0, 16);
    await ShortLink.create({
      code,
      targetUrl: '//evil.com/phish',
      resourceType: 'PRODUCT',
      resourceId: null,
      metadata: { name: 'Your account is locked', price: 1, imageUrl: 'https://evil.example/x.png' },
      clicks: 0,
    });
    created.push(code);
    const resolved = await shortLinksService.resolveShortLink(code);
    assert.equal(resolved.targetUrl, '/');
    assert.equal(resolved.metadata, null);
  });

  it('regression: a legacy row with markup in its target is encoded on read', async () => {
    const code = `legacx${Date.now().toString(36)}`.slice(0, 16);
    await ShortLink.create({
      code,
      targetUrl: '/</script><script>alert(1)</script>',
      resourceType: 'PRODUCT',
      resourceId: null,
      metadata: null,
      clicks: 0,
    });
    created.push(code);
    assert.doesNotMatch((await shortLinksService.resolveShortLink(code)).targetUrl, /[<>]/);
  });

  it('a link for a LIVE product always points at that product with catalog-derived preview', async () => {
    const product = await Product.findOne({ where: { status: PRODUCT_STATUS.LIVE } });
    if (!product) return; // nothing seeded: covered by the cases above

    const link = await track(
      shortLinksService.createOrGetShortLink({
        targetUrl: '/somewhere/else',
        resourceId: product.id,
        metadata: { name: 'FAKE NAME', price: 1 },
      } as never),
    );
    assert.equal(link.targetUrl, `/products/${product.slug}`);
    assert.equal(link.resourceId, product.id);
    assert.equal(link.metadata?.name, product.name);
    assert.notEqual(link.metadata?.name, 'FAKE NAME');

    // A second caller cannot overwrite the preview or the target.
    const again = await shortLinksService.createOrGetShortLink({
      targetUrl: '/products/other',
      resourceId: product.id,
      metadata: { name: 'EVEN FAKER' },
    } as never);
    assert.equal(again.code, link.code);
    assert.equal(again.targetUrl, `/products/${product.slug}`);
    assert.equal(again.metadata?.name, product.name);
  });

  it('does not build a public preview for a product that is not live', async () => {
    const draft = await Product.findOne({ where: { status: PRODUCT_STATUS.DRAFT } });
    if (!draft) return;
    const link = await track(
      shortLinksService.createOrGetShortLink({ targetUrl: `/products/${draft.slug}`, resourceId: draft.id }),
    );
    assert.equal(link.metadata, null);
    assert.equal(link.resourceId, null);
  });
});
