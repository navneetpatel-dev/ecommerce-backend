import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@config/db';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { logger } from '@core/logger';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { notificationsService } from '@modules/notifications/notifications.service';

/** Options of a vendor's published listing that a tax change has just put above its MRP. */
export type BlockedListing = { vendorId: string; productName: string; variants: number };

const MAX_NAMES = 10;

/** One email per vendor naming the listings that stopped selling. Never throws. */
export async function notifyAboveMrp(blocked: BlockedListing[]): Promise<void> {
  const byVendor = new Map<string, BlockedListing[]>();
  for (const listing of blocked) byVendor.set(listing.vendorId, [...(byVendor.get(listing.vendorId) ?? []), listing]);
  const run = randomUUID();
  for (const [vendorId, listings] of byVendor) {
    try {
      const names = listings.slice(0, MAX_NAMES).map((listing) => `${listing.productName} (${listing.variants})`).join('; ');
      const more = listings.length - MAX_NAMES;
      const users = await User.findAll({ where: { vendorId }, attributes: ['id'] });
      for (const user of users) {
        await notificationsService.enqueue({
          userId: user.id,
          type: 'PRODUCT_ABOVE_MRP',
          referenceType: 'Vendor',
          referenceId: `${run}:${user.id}`,
          templateData: {
            productName: listings.length > 1 ? `${listings.length} of your products` : listings[0]!.productName,
            productList: more > 0 ? `${names}; and ${more} more` : names,
          },
        });
      }
    } catch (error) {
      logger.error('Telling a vendor about over-MRP listings failed', {
        vendorId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const MAX_REVIEWERS = 100;

/** The active platform users who approve products (Super Admins and roles holding `product.approve`). */
async function productReviewerIds(): Promise<string[]> {
  const rows = await sequelize.query<{ id: string }>(
    `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u."roleId" AND r."deletedAt" IS NULL
     WHERE u."deletedAt" IS NULL AND u.status = 'ACTIVE' AND u."vendorId" IS NULL
       AND (r.name = :superAdmin OR EXISTS (
         SELECT 1 FROM "RolePermissions" rp INNER JOIN permissions p ON p.id = rp."permissionId"
         WHERE rp."roleId" = r.id AND p.key = :approve))
     ORDER BY u."createdAt" DESC LIMIT :limit`,
    {
      replacements: { superAdmin: ROLES.SUPER_ADMIN, approve: PERMISSIONS.PRODUCT_APPROVE, limit: MAX_REVIEWERS },
      type: QueryTypes.SELECT,
    },
  );
  return rows.map((row) => row.id);
}

/** A vendor changed a live listing: one email per reviewer per product per day. Never throws. */
export async function notifyAdminsOfVendorEdit(edit: {
  productId: string;
  productName: string;
  vendorId: string;
  changes: string;
}): Promise<void> {
  try {
    const vendor = await Vendor.findByPk(edit.vendorId, { attributes: ['businessName'] });
    const day = new Date().toISOString().slice(0, 10);
    for (const userId of await productReviewerIds()) {
      await notificationsService.enqueue({
        userId,
        type: 'ADMIN_VENDOR_PRODUCT_EDITED',
        referenceType: 'Product',
        referenceId: `${edit.productId}:${day}`,
        templateData: {
          productName: edit.productName,
          vendorName: vendor?.businessName ?? 'A vendor',
          changes: edit.changes,
        },
      });
    }
  } catch (error) {
    logger.error('Telling admins about a live listing edit failed', {
      productId: edit.productId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
