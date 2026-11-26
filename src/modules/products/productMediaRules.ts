import type { Transaction } from 'sequelize';
import { isS3Configured } from '@config/s3';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { MAX_PRODUCT_IMAGES } from '@core/constants/product';
import { ValidationError } from '@core/errors/ValidationError';
import { NOT_AN_UPLOAD, isOwnStorageUrl } from '@core/s3/ownStorageUrl';
import { ProductImage } from '@database/models/productImage.model';

/** Whether uploads can be verified at all (a seam so tests can switch it). */
export const mediaStorage = { configured: () => isS3Configured() };

type MediaPurpose = 'images' | 'video' | 'size-chart';

/**
 * Product media must be files uploaded through the app (our storage, the products folder, the right
 * purpose), not links to other sites. Skipped only where storage is not configured at all.
 */
export function assertProductMediaUrl(url: string | null | undefined, purpose: MediaPurpose, field: string): void {
  if (!url || !mediaStorage.configured()) return;
  if (!isOwnStorageUrl(url, { entityType: 'products', purpose })) throw new ValidationError({ [field]: [NOT_AN_UPLOAD] });
}

/**
 * The video and size chart of a create or update. On update only a changed link is checked, so a form
 * that sends an older product's existing link back unchanged still saves.
 */
export function assertProductMediaUrls(
  next: { videoUrl?: string | null; sizeChartUrl?: string | null },
  current: { videoUrl?: string | null; sizeChartUrl?: string | null } = {},
): void {
  if (next.videoUrl !== current.videoUrl) assertProductMediaUrl(next.videoUrl, 'video', 'videoUrl');
  if (next.sizeChartUrl !== current.sizeChartUrl) assertProductMediaUrl(next.sizeChartUrl, 'size-chart', 'sizeChartUrl');
}

/** A new product image: an uploaded file, and room for it (at most MAX_PRODUCT_IMAGES per product). */
export async function assertCanAddImage(productId: string, url: string, transaction: Transaction): Promise<void> {
  assertProductMediaUrl(url, 'images', 'url');
  const count = await ProductImage.count({ where: { productId }, transaction });
  if (count >= MAX_PRODUCT_IMAGES) throw new ValidationError(ERROR_MESSAGES.PRODUCT_IMAGES_LIMIT);
}
