import crypto from 'crypto';
import { ShortLink, Product, ProductImage, Category, Vendor } from '@database/models';
import { NotFoundError } from '@core/errors/NotFoundError';
import { env } from '@config/env';

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
  metadata: Record<string, any> | null;
  clicks: number;
  createdAt: Date;
}

export class ShortLinksService {
  private getClientBaseUrl(): string {
    return process.env.CLIENT_URL || env.CLIENT_URL || 'http://localhost:5273';
  }

  async createOrGetShortLink(dto: CreateShortLinkDto): Promise<ShortLinkResponse> {
    const resourceType = dto.resourceType || 'PRODUCT';
    const resourceId = dto.resourceId || null;
    let targetUrl = dto.targetUrl?.trim();

    if (!targetUrl) {
      if (resourceType === 'PRODUCT' && resourceId) {
        const prod = await Product.findByPk(resourceId);
        if (prod) {
          targetUrl = `/products/${prod.slug}`;
        }
      }
    }

    if (!targetUrl) {
      targetUrl = '/';
    }

    // Strip host if full URL was provided, keep path + query
    try {
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        const parsed = new URL(targetUrl);
        targetUrl = `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      // keep as is
    }

    // Check if short link already exists for this resource
    if (resourceType === 'PRODUCT' && resourceId) {
      const existing = await ShortLink.findOne({
        where: { resourceType, resourceId },
      });

      if (existing) {
        // If metadata was provided and wasn't cached before, enrich it
        if (dto.metadata && (!existing.metadata || Object.keys(existing.metadata).length === 0)) {
          existing.metadata = { ...dto.metadata };
          await existing.save();
        }
        return this.formatResponse(existing);
      }
    }

    // Also check if targetUrl already has an existing short link
    const existingByUrl = await ShortLink.findOne({
      where: { targetUrl },
    });
    if (existingByUrl) {
      if (dto.metadata && (!existingByUrl.metadata || Object.keys(existingByUrl.metadata).length === 0)) {
        existingByUrl.metadata = { ...dto.metadata };
        await existingByUrl.save();
      }
      return this.formatResponse(existingByUrl);
    }

    // Assemble metadata if missing
    let finalMetadata = dto.metadata ? { ...dto.metadata } : null;
    if ((!finalMetadata || !finalMetadata.imageUrl || !finalMetadata.name) && resourceType === 'PRODUCT' && resourceId) {
      const product = await Product.findByPk(resourceId, {
        include: [
          { model: ProductImage, as: 'images' },
          { model: Category },
          { model: Vendor, as: 'vendor' },
        ],
      });

      if (product) {
        const primaryImg = product.images?.find((img) => img.isPrimary)?.url || product.images?.[0]?.url || '';
        finalMetadata = {
          name: product.name,
          description: product.description ? product.description.slice(0, 300) : '',
          imageUrl: primaryImg,
          price: product.displayPrice ? Number(product.displayPrice) : Number(product.basePrice),
          currency: 'INR',
          brand: product.brand || undefined,
          category: (product as any).Category?.name || undefined,
          ...finalMetadata,
        };
      }
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

    const shortLink = await ShortLink.create({
      code,
      targetUrl,
      resourceType,
      resourceId,
      metadata: finalMetadata,
      clicks: 0,
    });

    return this.formatResponse(shortLink);
  }

  async resolveShortLink(code: string): Promise<ShortLinkResponse> {
    const link = await ShortLink.findOne({ where: { code } });

    if (link) {
      // Async click tracking
      link.increment('clicks').catch(() => {});

      // Enrich metadata if missing
      if (link.resourceType === 'PRODUCT' && link.resourceId && (!link.metadata || !link.metadata.imageUrl)) {
        const product = await Product.findByPk(link.resourceId, {
          include: [
            { model: ProductImage, as: 'images' },
            { model: Category },
          ],
        });
        if (product) {
          const primaryImg = product.images?.find((img) => img.isPrimary)?.url || product.images?.[0]?.url || '';
          link.metadata = {
            ...(link.metadata || {}),
            name: product.name,
            description: product.description ? product.description.slice(0, 300) : '',
            imageUrl: primaryImg,
            price: product.displayPrice ? Number(product.displayPrice) : Number(product.basePrice),
            currency: 'INR',
          };
          link.save().catch(() => {});
        }
      }

      return this.formatResponse(link);
    }

    // Fallback: check if code is a product slug
    const product = await Product.findOne({
      where: { slug: code },
      include: [
        { model: ProductImage, as: 'images' },
        { model: Category },
      ],
    });

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

  private formatResponse(link: ShortLink): ShortLinkResponse {
    const clientBase = this.getClientBaseUrl();
    return {
      id: link.id,
      code: link.code,
      targetUrl: link.targetUrl,
      shortUrl: `${clientBase}/s/${link.code}`,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      metadata: link.metadata,
      clicks: link.clicks,
      createdAt: link.createdAt,
    };
  }
}

export const shortLinksService = new ShortLinksService();
