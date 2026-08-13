import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_BYTES } from './constants';
import type { S3EntityType, S3Purpose } from './constants';

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export interface ImageUploadSpec {
  /** Target width after crop/resize (px). */
  outputWidth: number;
  /** Target height after crop/resize (px). */
  outputHeight: number;
  /** Crop aspect ratio (width / height). */
  aspectRatio: number;
  maxBytes: number;
  /** Optional higher ceiling for video mime types under the same purpose. */
  videoMaxBytes?: number;
  mimeTypes: readonly string[];
  cropRequired: boolean;
}

const AVATAR_MAX_BYTES = Math.floor(1.5 * 1024 * 1024);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const ATTACHMENT_MEDIA_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES] as const;

/** Upload specs keyed by `{entityType}:{purpose}` — mirrors frontend `imageSpecs.ts`. */
export const IMAGE_UPLOAD_SPECS: Record<string, ImageUploadSpec> = {
  'banners:image': {
    outputWidth: 1920,
    outputHeight: 1080,
    aspectRatio: 16 / 9,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'categories:image': {
    outputWidth: 1200,
    outputHeight: 900,
    aspectRatio: 4 / 3,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'products:images': {
    outputWidth: 1200,
    outputHeight: 1200,
    aspectRatio: 1,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'products:video': {
    outputWidth: 0,
    outputHeight: 0,
    aspectRatio: 0,
    maxBytes: MAX_VIDEO_UPLOAD_BYTES,
    videoMaxBytes: MAX_VIDEO_UPLOAD_BYTES,
    mimeTypes: VIDEO_MIME_TYPES,
    cropRequired: false,
  },
  'products:size-chart': {
    outputWidth: 1200,
    outputHeight: 900,
    aspectRatio: 4 / 3,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'vendors:logo': {
    outputWidth: 512,
    outputHeight: 512,
    aspectRatio: 1,
    maxBytes: LOGO_MAX_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'vendors:banner': {
    outputWidth: 1680,
    outputHeight: 525,
    aspectRatio: 16 / 5,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'users:avatar': {
    outputWidth: 512,
    outputHeight: 512,
    aspectRatio: 1,
    maxBytes: AVATAR_MAX_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'returns:photos': {
    outputWidth: 1600,
    outputHeight: 1200,
    aspectRatio: 4 / 3,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: IMAGE_MIME_TYPES,
    cropRequired: true,
  },
  'vendors:kyc': {
    outputWidth: 0,
    outputHeight: 0,
    aspectRatio: 0,
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: DOCUMENT_MIME_TYPES,
    cropRequired: false,
  },
  'tickets:attachments': {
    outputWidth: 0,
    outputHeight: 0,
    aspectRatio: 0,
    maxBytes: MAX_UPLOAD_BYTES,
    videoMaxBytes: MAX_VIDEO_UPLOAD_BYTES,
    mimeTypes: ATTACHMENT_MEDIA_TYPES,
    cropRequired: false,
  },
  'bug-reports:attachments': {
    outputWidth: 0,
    outputHeight: 0,
    aspectRatio: 0,
    maxBytes: MAX_UPLOAD_BYTES,
    videoMaxBytes: MAX_VIDEO_UPLOAD_BYTES,
    mimeTypes: ATTACHMENT_MEDIA_TYPES,
    cropRequired: false,
  },
};

export function imageUploadSpecKey(entityType: S3EntityType, purpose: S3Purpose): string {
  return `${entityType}:${purpose}`;
}

export function getImageUploadSpec(
  entityType: S3EntityType,
  purpose: S3Purpose,
): ImageUploadSpec | null {
  return IMAGE_UPLOAD_SPECS[imageUploadSpecKey(entityType, purpose)] ?? null;
}

function normalizeMime(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isVideoMimeType(contentType: string): boolean {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(normalizeMime(contentType));
}

export function resolveMaxUploadBytes(
  entityType: S3EntityType,
  purpose: S3Purpose,
  contentType?: string,
): number {
  const spec = getImageUploadSpec(entityType, purpose);
  if (!spec) return MAX_UPLOAD_BYTES;
  if (contentType && isVideoMimeType(contentType) && spec.videoMaxBytes != null) {
    return spec.videoMaxBytes;
  }
  return spec.maxBytes;
}

export function assertValidUploadContentType(
  entityType: S3EntityType,
  purpose: S3Purpose,
  contentType: string,
): void {
  const spec = getImageUploadSpec(entityType, purpose);
  if (!spec) return;

  const normalized = normalizeMime(contentType);
  if (!spec.mimeTypes.includes(normalized)) {
    throw new ValidationError({
      contentType: [ERROR_MESSAGES.UPLOAD_INVALID_CONTENT_TYPE],
    });
  }
}

export function assertValidUploadSize(
  entityType: S3EntityType,
  purpose: S3Purpose,
  byteLength: number,
  contentType?: string,
): void {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new ValidationError({
      contentLength: [ERROR_MESSAGES.UPLOAD_EMPTY],
    });
  }
  const maxBytes = resolveMaxUploadBytes(entityType, purpose, contentType);
  if (byteLength > maxBytes) {
    throw new ValidationError({
      contentLength: [ERROR_MESSAGES.UPLOAD_TOO_LARGE],
    });
  }
}
