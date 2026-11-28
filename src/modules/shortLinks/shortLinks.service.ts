import crypto from 'crypto';
import { ShortLink, Product, ProductImage, Category } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { env } from '@config/env';
import type { ProductWithRelations } from '@core/catalog/productRelations';

const BASE62_CHARS = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function generateShortCode(length = 7): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62_CHARS[bytes[i]! % BASE62_CHARS.length];
  }
  return code;
}

export interface CreateShortLinkDto {
  targetUrl: string;
  resourceType?: string;
  resourceId?: string;
  /** Accepted for backward compatibility but ignored: previews are always derived from the catalog. */
  metadata?: {
    name?: string;
    description?: string;
    imageUrl?: string;
    price?: number;
    currency?: string;
    brand?: string;
    category?: string;
  };
}

export interface ShortLinkResponse {
  id: string;
  code: string;
  targetUrl: string;
  shortUrl: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  clicks: number;
  createdAt: Date;
}

const MAX_TARGET_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\\]/;
const PLACEHOLDER_ORIGIN = 'https://placeholder.invalid';

/**
 * Reduces any input to a canonical same-site path (`/…`). A short link is rendered by the web app
 * as `location.replace(targetUrl)` inside an inline script, so anything that could leave the site
 * (`//evil.com`, `/\evil.com`, `javascript:…`, another host) collapses to `/`, and the rest is
 * re-serialised the way a browser reads it, which percent-encodes `<`, `>`, quotes and spaces.
 * For absolute http(s) URLs only the path and query are kept (the host is dropped).
 */
export function safeSitePath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  let value = raw.trim();
  if (!value || value.length > MAX_TARGET_LENGTH) return '/';
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      value = `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/';
    }
  }
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_PATH_CHARS.test(value)) return '/';
  try {
    const url = new URL(value, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return '/';
    const path = `${url.pathname}${url.search}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
}

const PRODUCT_PATH = /^\/products\/([^/?#]+)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LinkMetadata = NonNullable<ShortLinkResponse['metadata']>;

export class ShortLinksService {
  private getClientBaseUrl(): string {
    return process.env.CLIENT_URL || env.CLIENT_URL || 'http://localhost:5273';
  }

  /** The product on sale that a link is about: by id when given, else by the slug in its path. */
  private async findProduct(resourceId: string | null, targetUrl: string): Promise<Product | null> {
    const include = [
      { model: ProductImage, as: 'images' },
      { model: Category },
    ];
    // The shop's own visibility rule: a link never previews something shoppers cannot open.
    const onSale = () => Product.scope('customerVisible');
    if (resourceId && UUID.test(resourceId)) {
      return onSale().findOne({ where: { id: resourceId }, include });
    }
    const slug = PRODUCT_PATH.exec(targetUrl)?.[1];
    if (!slug) return null;
    let decoded = slug;
    try {
      decoded = decodeURIComponent(slug);
    } catch {
      return null;
    }
    return onSale().findOne({ where: { slug: decoded }, include });
  }

  /** Preview data always comes from the catalog, never from what a caller sent. */
  private metadataFor(product: Product | null): LinkMetadata | null {
    if (!product) return null;
    const primaryImg = product.images?.find((img) => img.isPrimary)?.url || product.images?.[0]?.url || '';
    return {
      name: product.name,
      description: product.description ? product.description.slice(0, 300) : '',
      imageUrl: primaryImg,
      price: product.displayPrice ? Number(product.displayPrice) : Number(product.basePrice),
      currency: 'INR',
      brand: product.brand || undefined,
      category: (product as ProductWithRelations).Category?.name || undefined,
    };
  }

  async createOrGetShortLink(dto: CreateShortLinkDto): Promise<ShortLinkResponse> {
    const resourceType = 'PRODUCT';
    const resourceId = dto.resourceId && UUID.test(dto.resourceId) ? dto.resourceId : null;

    let targetUrl = safeSitePath(dto.targetUrl);
    const product = await this.findProduct(resourceId, targetUrl);
    // A link about a product always points at that product, whatever target the caller asked for.
    if (product && resourceId) {
      targetUrl = `/products/${product.slug}`;
    }
    const linkedResourceId = product ? product.id : null;

    // One short link per product, and per target path.
    const existing =
      (linkedResourceId ? await ShortLink.findOne({ where: { resourceType, resourceId: linkedResourceId } }) : null) ??
      (await ShortLink.findOne({ where: { targetUrl } }));
    if (existing) {
      return this.formatResponse(existing, { targetUrl: safeSitePath(existing.targetUrl), metadata: this.metadataFor(product) });
    }

    // Generate unique code with collision retry
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateShortCode(7);
      const clash = await ShortLink.findOne({ where: { code: candidate } });
      if (!clash) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      code = generateShortCode(9);
    }

    const metadata = this.metadataFor(product);
    const shortLink = await ShortLink.create({
      code,
      targetUrl,
      resourceType,
      resourceId: linkedResourceId,
      metadata,
      clicks: 0,
    });

    return this.formatResponse(shortLink, { targetUrl, metadata });
  }

  async resolveShortLink(code: string): Promise<ShortLinkResponse> {
    const link = await ShortLink.findOne({ where: { code } });

    if (link) {
      // Async click tracking
      link.increment('clicks').catch(() => {});

      // Rows written before validation existed may hold an off-site target or caller-supplied
      // preview text, so both are recomputed on every read instead of trusted.
      const targetUrl = safeSitePath(link.targetUrl);
      const product = await this.findProduct(link.resourceId, targetUrl);
      return this.formatResponse(link, { targetUrl, metadata: this.metadataFor(product) });
    }

    // Fallback: check if code is a product slug
    const product = await this.findProduct(null, `/products/${encodeURIComponent(code)}`);

    if (product) {
      // Auto-create short link for this product
      return this.createOrGetShortLink({
        targetUrl: `/products/${product.slug}`,
        resourceType: 'PRODUCT',
        resourceId: product.id,
      });
    }

    throw new NotFoundError('Short link');
  }

  private formatResponse(
    link: ShortLink,
    override?: { targetUrl: string; metadata: LinkMetadata | null },
  ): ShortLinkResponse {
    const clientBase = this.getClientBaseUrl();
    return {
      id: link.id,
      code: link.code,
      targetUrl: override ? override.targetUrl : safeSitePath(link.targetUrl),
      shortUrl: `${clientBase}/s/${link.code}`,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      metadata: override ? override.metadata : null,
      clicks: link.clicks,
      createdAt: link.createdAt,
    };
  }
}

export const shortLinksService = new ShortLinksService();
