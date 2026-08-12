import {
  copyObject,
  deleteByPrefix,
  deleteObject,
  deleteObjects,
  extractS3KeyFromUrl,
  isS3Configured,
  publicObjectUrl,
} from '@config/s3';
import { logger } from '@core/logger';
import { buildS3EntityPrefix, buildS3Key } from './buildS3Key';
import type { S3EntityType } from './constants';

/** Deletes the S3 object pointed to by a public URL (no-op if not our key). */
export async function deleteS3ObjectByUrl(
  url: string | null | undefined,
  options: { strict?: boolean } = { strict: true },
): Promise<void> {
  if (!isS3Configured() || !url) return;
  const key = extractS3KeyFromUrl(url);
  if (!key) return;
  await deleteObject(key, options);
}

/** Batch-delete S3 objects referenced by public URLs (covers draft-UUID keys). */
export async function deleteS3ObjectsByUrls(
  urls: Array<string | null | undefined>,
): Promise<number> {
  if (!isS3Configured()) return 0;
  const keys = [
    ...new Set(
      urls
        .map((url) => extractS3KeyFromUrl(url))
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  if (keys.length === 0) return 0;
  return deleteObjects(keys);
}

/**
 * When a media URL field is replaced, delete the previous object so it does not accumulate.
 * Skips when old === new or old is missing.
 */
export async function deleteS3ObjectIfReplaced(
  previousUrl: string | null | undefined,
  nextUrl: string | null | undefined,
): Promise<void> {
  if (!previousUrl || previousUrl === nextUrl) return;
  await deleteS3ObjectByUrl(previousUrl);
}

/**
 * Copy draft-entity uploads under the final entity id and return the rebased public URLs.
 * When S3 is not configured, returns the input URLs unchanged.
 */
export async function rebaseAttachmentUrlsToEntity(params: {
  entityType: S3EntityType;
  entityId: string;
  purpose: 'attachments';
  urls: string[];
}): Promise<string[]> {
  if (!isS3Configured() || params.urls.length === 0) return params.urls;

  const nextUrls: string[] = [];
  for (const url of params.urls) {
    const sourceKey = extractS3KeyFromUrl(url);
    if (!sourceKey) {
      nextUrls.push(url);
      continue;
    }
    const filename = sourceKey.split('/').pop() || 'file.bin';
    const destKey = buildS3Key(params.entityType, params.entityId, params.purpose, filename);
    if (sourceKey === destKey) {
      nextUrls.push(url);
      continue;
    }
    await copyObject(sourceKey, destKey);
    nextUrls.push(publicObjectUrl(destKey));
    await deleteObject(sourceKey, { strict: false }).catch(() => undefined);
  }
  return nextUrls;
}

/**
 * Cascade-delete media for a parent entity:
 * 1) every object under `{env}/{entityType}/{entityId}/`
 * 2) every key referenced by `referencedUrls` (draft-UUID uploads attached later)
 */
export async function cascadeDeleteEntityMedia(
  entityType: S3EntityType,
  entityId: string,
  referencedUrls: Array<string | null | undefined> = [],
): Promise<number> {
  if (!isS3Configured()) return 0;

  const prefix = buildS3EntityPrefix(entityType, entityId);
  const fromPrefix = await deleteByPrefix(prefix);
  const fromUrls = await deleteS3ObjectsByUrls(referencedUrls);
  const deleted = fromPrefix + fromUrls;

  if (deleted > 0) {
    logger.info('Cascaded S3 delete for entity', {
      entityType,
      entityId,
      prefix,
      fromPrefix,
      fromUrls,
      deleted,
    });
  }
  return deleted;
}
