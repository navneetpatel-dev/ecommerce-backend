import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@config/env';
import { logger } from '@core/logger';

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
  logger.warn('AWS S3 client not configured — avatar uploads require AWS credentials');
}

export function isS3Configured(): boolean {
  return Boolean(s3Client);
}

export function publicObjectUrl(key: string): string {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
  return `https://${S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

export function extractS3KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    if (env.S3_PUBLIC_BASE_URL && url.startsWith(env.S3_PUBLIC_BASE_URL)) {
      return url.slice(env.S3_PUBLIC_BASE_URL.replace(/\/$/, '').length + 1).split('?')[0] || null;
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

export async function uploadObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  if (!s3Client) {
    throw new Error('S3 is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET.');
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return publicObjectUrl(params.key);
}

export async function deleteObject(key: string): Promise<void> {
  if (!s3Client) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    );
  } catch (error) {
    logger.warn('Failed to delete S3 object', {
      key,
      error: error instanceof Error ? error.message : error,
    });
  }
}
