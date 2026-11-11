import { extractS3KeyFromUrl, publicObjectUrl } from '@config/s3';
import { ValidationError } from '@core/errors/ValidationError';
import { parseS3Key } from './buildS3Key';
import type { S3EntityType, S3Purpose } from './constants';

export const NOT_AN_UPLOAD = 'Attach files from your device; links to other sites are not accepted';

/**
 * True for an https link to a file on the store's own storage that this
 * environment issued for `entityType` / `purpose` (and `entityId`, when given).
 * Links to other sites, other buckets, other folders, http and script URLs fail.
 */
export function isOwnStorageUrl(
  url: string,
  expected: { entityType: S3EntityType; purpose: S3Purpose; entityId?: string },
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const key = extractS3KeyFromUrl(url);
  if (!key || publicObjectUrl(key) !== url.split('?')[0]) return false;
  const owner = parseS3Key(key);
  if (!owner || owner.entityType !== expected.entityType || owner.purpose !== expected.purpose) return false;
  return expected.entityId === undefined || owner.entityId === expected.entityId;
}

/** Ticket and bug-report attachments must be files uploaded for that kind of record. */
export function assertAttachmentsUploaded(
  attachments: Array<{ url: string }>,
  entityType: S3EntityType,
  purpose: S3Purpose,
): void {
  if (attachments.some((a) => !isOwnStorageUrl(a.url, { entityType, purpose }))) {
    throw new ValidationError({ attachmentUrls: [NOT_AN_UPLOAD] });
  }
}
