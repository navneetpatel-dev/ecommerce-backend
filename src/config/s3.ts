import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@config/env';
import { AppError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { logger } from '@core/logger';

/** Default expiry for KYC / private object viewing. */
const SIGNED_GET_EXPIRES_SECONDS = 15 * 60;
const SIGNED_PUT_EXPIRES_SECONDS = 15 * 60;

export const S3_BUCKET = env.S3_BUCKET;

const hasAwsCredentials = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

export const s3Client = hasAwsCredentials
  ? new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : null;

if (!s3Client) {
  logger.warn('AWS S3 client not configured — media uploads require AWS credentials');
}

export function isS3Configured(): boolean {
  return Boolean(s3Client);
}

export function normalizedPublicBaseUrl(): string | null {
  if (!env.S3_PUBLIC_BASE_URL) return null;
  return env.S3_PUBLIC_BASE_URL.replace(/\/$/, '');
}

export function publicObjectUrl(key: string): string {
  const base = normalizedPublicBaseUrl();
  if (base) {
    return `${base}/${key}`;
  }
  return `https://${S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

/** Returns true when the object exists in the configured bucket. */
export async function objectExists(key: string): Promise<boolean> {
  if (!s3Client) return false;
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Short-lived signed GET URL for viewing objects (falls back to public URL if S3 unset). */
export async function signedGetObjectUrl(
  key: string,
  expiresInSeconds = SIGNED_GET_EXPIRES_SECONDS,
): Promise<string> {
  if (!s3Client) {
    return publicObjectUrl(key);
  }
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * Sign many S3 keys in one pass — dedupes keys so threads with repeated objects
 * do not pay N identical signing round-trips.
 */
export async function signedGetObjectUrlMap(
  keys: Array<string | null | undefined>,
  expiresInSeconds = SIGNED_GET_EXPIRES_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  const entries = await Promise.all(
    unique.map(async (key) => [key, await signedGetObjectUrl(key, expiresInSeconds)] as const),
  );
  return new Map(entries);
}

/**
 * Pre-signed PUT for direct client upload (Phase 1).
 * `contentLength` is signed so S3 rejects bodies that don't match the declared size.
 */
export async function signedPutObjectUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresInSeconds = SIGNED_PUT_EXPIRES_SECONDS,
): Promise<string> {
  if (!s3Client) {
    throw new AppError(ERROR_MESSAGES.S3_NOT_CONFIGURED, 503, ERROR_CODES.S3_NOT_CONFIGURED);
  }
  return getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Server-side copy used to rebase draft-UUID uploads onto the final entity id. */
export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  if (!s3Client) return;
  if (sourceKey === destKey) return;
  try {
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${sourceKey}`,
        Key: destKey,
      }),
    );
  } catch (error) {
    rethrowS3Error(error);
  }
}

export function extractS3KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const base = normalizedPublicBaseUrl();
    if (base) {
      const normalized = url.split('?')[0]!;
      if (normalized.startsWith(`${base}/`)) {
        return normalized.slice(base.length + 1) || null;
      }
      // Env may include trailing slash while stored URLs use normalized base.
      const rawBase = env.S3_PUBLIC_BASE_URL!;
      if (normalized.startsWith(`${rawBase}/`) || normalized.startsWith(`${rawBase.replace(/\/$/, '')}/`)) {
        const prefix = rawBase.replace(/\/$/, '');
        return normalized.slice(prefix.length + 1) || null;
      }
    }
    const marker = `.amazonaws.com/`;
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      return url.slice(idx + marker.length).split('?')[0] || null;
    }
  } catch {
    return null;
  }
  return null;
}

function isS3AccessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name: unknown }).name) : '';
  const message = 'message' in error ? String((error as { message: unknown }).message) : '';
  return name === 'AccessDenied' || /not authorized to perform: s3:/i.test(message);
}

function rethrowS3Error(error: unknown): never {
  if (isS3AccessDenied(error)) {
    throw new AppError(ERROR_MESSAGES.S3_ACCESS_DENIED, 503, ERROR_CODES.S3_ACCESS_DENIED, undefined, {
      cause: error,
    });
  }
  throw new AppError(ERROR_MESSAGES.UPLOAD_FAILED, 503, ERROR_CODES.UPLOAD_FAILED, undefined, {
    cause: error instanceof Error ? error : undefined,
  });
}

export async function uploadObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
  /** When true, object is not given public cache headers (KYC / private media). */
  privateObject?: boolean;
}): Promise<string> {
  if (!s3Client) {
    throw new AppError(ERROR_MESSAGES.S3_NOT_CONFIGURED, 503, ERROR_CODES.S3_NOT_CONFIGURED);
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ...(params.privateObject
        ? {}
        : { CacheControl: 'public, max-age=31536000, immutable' }),
    }),
  ).catch(rethrowS3Error);

  return publicObjectUrl(params.key);
}

/** Multipart upload from a readable stream (report exports). */
export async function uploadObjectStream(params: {
  key: string;
  stream: Readable;
  contentType: string;
  privateObject?: boolean;
  contentDisposition?: string;
}): Promise<string> {
  if (!s3Client) {
    throw new AppError(ERROR_MESSAGES.S3_NOT_CONFIGURED, 503, ERROR_CODES.S3_NOT_CONFIGURED);
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: params.key,
      Body: params.stream,
      ContentType: params.contentType,
      ...(params.contentDisposition
        ? { ContentDisposition: params.contentDisposition }
        : {}),
      ...(params.privateObject
        ? {}
        : { CacheControl: 'public, max-age=31536000, immutable' }),
    },
  });

  await upload.done().catch(rethrowS3Error);
  return publicObjectUrl(params.key);
}

export async function deleteObject(key: string, options: { strict?: boolean } = {}): Promise<void> {
  if (!s3Client) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );
  } catch (error) {
    if (options.strict) {
      throw new AppError(ERROR_MESSAGES.UPLOAD_FAILED, 503, ERROR_CODES.UPLOAD_FAILED, undefined, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to delete S3 object', { key, error: message });
  }
}

export type ListedS3Object = {
  key: string;
  lastModified: Date | null;
  size: number;
};

/** Lists all objects under a prefix (paginated). */
export async function listObjectsByPrefix(prefix: string): Promise<ListedS3Object[]> {
  if (!s3Client) return [];

  const objects: ListedS3Object[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of page.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({
        key: item.Key,
        lastModified: item.LastModified ?? null,
        size: item.Size ?? 0,
      });
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Batch-delete keys (chunks of 1000 — S3 API limit). Returns deleted count. */
export async function deleteObjects(keys: string[]): Promise<number> {
  if (!s3Client || keys.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += result.Deleted?.length ?? chunk.length;
    if (result.Errors?.length) {
      logger.warn('Partial S3 batch delete failures', {
        errors: result.Errors.slice(0, 5),
        count: result.Errors.length,
      });
    }
  }
  return deleted;
}

/** Lists then batch-deletes every object under a prefix. */
export async function deleteByPrefix(prefix: string): Promise<number> {
  const listed = await listObjectsByPrefix(prefix);
  if (listed.length === 0) return 0;
  return deleteObjects(listed.map((o) => o.key));
}
