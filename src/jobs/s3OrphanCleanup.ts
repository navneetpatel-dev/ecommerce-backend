import { env } from '@config/env';
import { deleteObjects, extractS3KeyFromUrl, isS3Configured, listObjectsByPrefix } from '@config/s3';
import { logger } from '@core/logger';
import { S3_ORPHAN_MAX_AGE_MS } from '@core/s3';
import { Product } from '@database/models/product.model';
import { ProductImage } from '@database/models/productImage.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorDocument } from '@database/models/vendorDocument.model';
import { Category } from '@database/models/category.model';
import { User } from '@database/models/user.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { PromoBanner } from '@database/models/promoBanner.model';
import { TicketAttachment } from '@database/models/ticketAttachment.model';
import { BugReportAttachment } from '@database/models/bugReportAttachment.model';

export const S3_ORPHAN_CLEANUP_JOB = 's3-orphan-cleanup';

export type S3OrphanCleanupOptions = {
  dryRun?: boolean;
};

function collectKeysFromUrls(urls: Array<string | null | undefined>, into: Set<string>): void {
  for (const url of urls) {
    const key = extractS3KeyFromUrl(url);
    if (key) into.add(key);
  }
}

/** Only keys referenced by non-deleted parent rows (paranoid default). */
async function loadReferencedKeys(): Promise<Set<string>> {
  const keys = new Set<string>();

  const [
    images,
    vendors,
    documents,
    categories,
    users,
    returns,
    banners,
    ticketAttachments,
    bugAttachments,
  ] = await Promise.all([
    ProductImage.findAll({
      attributes: ['url'],
      include: [{ model: Product, attributes: [], required: true }],
    }),
    Vendor.findAll({ attributes: ['logoUrl', 'bannerUrl'] }),
    VendorDocument.findAll({
      attributes: ['url'],
      include: [{ model: Vendor, attributes: [], required: true }],
    }),
    Category.findAll({ attributes: ['imageUrl'] }),
    User.findAll({ attributes: ['avatarUrl'] }),
    ReturnRequest.findAll({ attributes: ['photoUrls'] }),
    PromoBanner.findAll({ attributes: ['imageUrl'] }),
    TicketAttachment.findAll({ attributes: ['url'] }),
    BugReportAttachment.findAll({ attributes: ['url'] }),
  ]);

  collectKeysFromUrls(
    images.map((r) => r.url),
    keys,
  );
  collectKeysFromUrls(
    vendors.flatMap((v) => [v.logoUrl, v.bannerUrl]),
    keys,
  );
  collectKeysFromUrls(
    documents.map((d) => d.url),
    keys,
  );
  collectKeysFromUrls(
    categories.map((c) => c.imageUrl),
    keys,
  );
  collectKeysFromUrls(
    users.map((u) => u.avatarUrl),
    keys,
  );
  for (const row of returns) {
    const photos = (row as ReturnRequest & { photoUrls?: string[] | null }).photoUrls;
    if (Array.isArray(photos)) collectKeysFromUrls(photos, keys);
  }
  collectKeysFromUrls(
    banners.map((b) => b.imageUrl),
    keys,
  );
  collectKeysFromUrls(
    ticketAttachments.map((a) => a.url),
    keys,
  );
  collectKeysFromUrls(
    bugAttachments.map((a) => a.url),
    keys,
  );

  return keys;
}

/**
 * Deletes S3 objects older than 24h under the current env prefix that are not
 * referenced by any media URL / fileKey in the database (abandoned Phase-1 uploads).
 */
export async function runS3OrphanCleanup(
  options: S3OrphanCleanupOptions = {},
): Promise<{ scanned: number; deleted: number; dryRun: boolean }> {
  const dryRun = options.dryRun ?? env.S3_ORPHAN_CLEANUP_DRY_RUN;

  if (!isS3Configured()) {
    logger.info('S3 orphan cleanup skipped — S3 not configured');
    return { scanned: 0, deleted: 0, dryRun };
  }

  const prefix = `${env.NODE_ENV}/`;
  const listed = await listObjectsByPrefix(prefix);
  const referenced = await loadReferencedKeys();
  const cutoff = Date.now() - S3_ORPHAN_MAX_AGE_MS;

  const orphans = listed.filter((obj) => {
    if (referenced.has(obj.key)) return false;
    if (!obj.lastModified) return false;
    return obj.lastModified.getTime() < cutoff;
  });

  if (orphans.length === 0) {
    logger.info('S3 orphan cleanup complete — nothing to delete', {
      scanned: listed.length,
      deleted: 0,
      dryRun,
      timestamp: new Date().toISOString(),
    });
    return { scanned: listed.length, deleted: 0, dryRun };
  }

  for (const orphan of orphans) {
    logger.info(dryRun ? 'S3 orphan candidate (dry run)' : 'S3 orphan deleted', {
      key: orphan.key,
      reason: 'no_matching_db_row_older_than_24h',
      lastModified: orphan.lastModified?.toISOString() ?? null,
      dryRun,
      timestamp: new Date().toISOString(),
    });
  }

  const deletedCount = dryRun ? 0 : await deleteObjects(orphans.map((o) => o.key));

  logger.info('S3 orphan cleanup complete', {
    scanned: listed.length,
    candidateCount: orphans.length,
    deleted: deletedCount,
    dryRun,
    timestamp: new Date().toISOString(),
  });

  return { scanned: listed.length, deleted: deletedCount, dryRun };
}
